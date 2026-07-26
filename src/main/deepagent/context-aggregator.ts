// D-07/D-08/D-09: Aggregate token breakdown for the current session's loaded context.
// Data sources: conversation (messages table), skills (resolved CDF Skill catalog),
// MCP tools (loadMcpTools), workflows (workflows table stages),
// system prompt (agents.system_prompt + buildProjectContext),
// system tools (built-in tool schemas — fetch/delete_file/bash/knowledge_search/knowledge_create/tavily/anysearch/arxiv).
// Token heuristic: Math.ceil(chars * 0.25) — OpenAI rough 1 token ≈ 4 chars.
// Per-source try-catch: if one source fails, the others still report real values.
//
// 08.2 P4 C2-01: extended to 11 categories + per-MCP-tool breakdown +
// autocompact buffer (context_limit × 15%, CDF 85% threshold) + free space.
// 08.2 polish: systemPrompt + systemTools + modelName upgraded from
// v1.1 placeholders to real calculations. customAgents + memoryFiles
// remain v1.1 placeholders (deepagent runtime does not expose subagent
// definitions; memory file system is not implemented) — deferred to v1.2+.

import fs from 'fs';
import log from '../logger';
import path from 'path';
import db from '../database';
import {
  buildProjectSkillsRuntime,
  getSkillDisplayName,
  getSkillSourceLabel,
  type ResolvedSkillCatalogEntry,
} from './skill-catalog';
import { loadMcpTools } from './mcp-connector';
import { getAgentMcpServers, getConnectedMcpServers } from './mcp-visibility';
import type { MCPServer } from '../../shared/types';
import { skillReferencesToPreloadNames } from '../../shared/skill-identifiers';
import { getOrCaptureConversationSystemContextSnapshot } from '../conversation-system-context-snapshot';
import { createAgentCatalog } from '../agent-catalog';
import { buildProjectContext } from './project-context';

export interface MCPToolDetail {
  tool: string;
  server: string;
  tokens: number;
}

// Per-source breakdown rows surfaced in the ContextModal expand sections
// (08.2 polish — addresses user feedback that only the MCP breakdown
// was being rendered, leaving Skills / Workflows / System tools /
// Project commands as opaque totals).
export interface SkillDetail {
  name: string;
  scope: 'global' | 'project';
  tokens: number;
  visibility?: string;
  sourceLabel?: string;
  preloaded?: boolean;
}
export interface WorkflowDetail {
  id: string;
  name: string;
  tokens: number;
}
export interface SystemToolDetail {
  name: string;
  tokens: number;
}
export interface ProjectCommandDetail {
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  // Original 4 (Phase 7) — kept for back-compat
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
  // 08.2 P4 — promoted to real calculations (polish after CONTEXT.md Issue 1):
  systemPrompt: number;          // 08.2 polish: agents.system_prompt + buildProjectContext
  systemTools: number;           // 08.2 polish: built-in tool schema sum
  customAgents: number;          // v1.1 placeholder — default 0 (v1.2 推)
  memoryFiles: number;           // v1.1 placeholder — default 0 (v1.2 推)
  messages: number;              // alias of conversation (Claude Code parity)
  projectCommandBodies: number;  // v1.1 real — sum .cdf/commands/*.md bytes × 0.25
  // 08.2 P4 NEW — computed totals:
  freeSpace: number;             // max(0, contextLimit - total - autocompactBuffer)
  autocompactBuffer: number;     // Math.ceil(contextLimit * 0.15)
  mcpPerTool: MCPToolDetail[];   // v1.1 real — per-tool breakdown (expandable in modal)
  // 08.2 polish — per-source breakdowns so the modal can show more than
  // the MCP tool list. Each array is empty when its category is 0.
  skillsPerSkill: SkillDetail[];
  workflowsPerWorkflow: WorkflowDetail[];
  systemToolsPerTool: SystemToolDetail[];
  projectCommandsPerFile: ProjectCommandDetail[];
}

export interface ContextAggregate {
  breakdown: ContextBreakdown;
  total: number;
  modelName: string;
  contextLimit: number;
  used: number;
  usedPct: number;
  freePct: number;
  mcpPerTool: MCPToolDetail[];
}

const ZERO_BREAKDOWN: ContextBreakdown = {
  conversation: 0,
  skills: 0,
  mcp: 0,
  workflows: 0,
  systemPrompt: 0,
  systemTools: 0,
  customAgents: 0,
  memoryFiles: 0,
  messages: 0,
  projectCommandBodies: 0,
  freeSpace: 0,
  autocompactBuffer: 0,
  mcpPerTool: [],
  skillsPerSkill: [],
  workflowsPerWorkflow: [],
  systemToolsPerTool: [],
  projectCommandsPerFile: [],
};

function safeMath(chars: number): number {
  return Math.ceil((chars || 0) * 0.25);
}

function safeFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

const DEFAULT_CONTEXT_LIMIT = 200_000;

function stripSkillFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  return end === -1
    ? content
    : content.slice(end + '\n---'.length).replace(/^\s+/, '');
}

function isPreloadedSkill(skill: ResolvedSkillCatalogEntry, preloadSkillNames: string[]): boolean {
  const preloadNames = new Set(preloadSkillNames);
  const displayName = getSkillDisplayName(skill);
  return preloadNames.has(skill.name) || preloadNames.has(displayName);
}

function getSkillScope(skill: ResolvedSkillCatalogEntry): 'global' | 'project' {
  return skill.sourceKind === 'user' || skill.sourceKind === 'built-in' || skill.sourceKind === 'enterprise'
    ? 'global'
    : 'project';
}

function estimateResolvedSkillContextChars(
  skill: ResolvedSkillCatalogEntry,
  preloadSkillNames: string[]
): { chars: number; preloaded: boolean } {
  const displayName = getSkillDisplayName(skill);
  let chars = 0;

  if (skill.modelDiscovery === 'full') {
    chars += [
      `- **${displayName}**: ${skill.description}`,
      `  -> Read \`${skill.skillPath}\` for full instructions`,
    ].join('\n').length;
  }

  const preloaded = skill.modelDiscovery === 'full' &&
    isPreloadedSkill(skill, preloadSkillNames);
  if (preloaded) {
    try {
      const body = stripSkillFrontmatter(fs.readFileSync(skill.skillPath, 'utf-8'));
      chars += [
        `### ${displayName}`,
        `Path: \`${skill.skillPath}\``,
        '',
        body,
      ].join('\n').length;
    } catch {
      chars += safeFileSize(skill.skillPath);
    }
  }

  return { chars, preloaded };
}

// === System-prompt estimate ===============================================
// runtime.ts appends the fixed CJK project-context block (buildProjectContext).
// Reuse that single source so the aggregator sizes the exact bytes the LLM
// receives — a hand-copied replica here had already drifted (curly vs straight
// quotes) and mis-estimated the token budget.
function buildProjectContextString(projectName: string, projectPath: string): string {
  return buildProjectContext({ name: projectName, path: projectPath });
}

// === Built-in tool schemas (08.2 polish) =================================
// Mirrors the schemas defined in:
//   - fetch-tool.ts (FETCH_SCHEMA)
//   - file-tools.ts (DELETE_FILE_SCHEMA)
//   - bash-tool.ts (inline schema for `bash`)
//   - knowledge-base.ts (KNOWLEDGE_SEARCH_SCHEMA, KNOWLEDGE_CREATE_SCHEMA)
//   - search-tools.ts (TAVILY_SCHEMA, ANYSEARCH_SCHEMA)
//   - arxiv-tool.ts (ARXIV_SCHEMA)
// Schema strings are duplicated here rather than imported so the aggregator
// stays independent of the deepagent tool factory. The tool's `.tool({...})`
// wrapper adds an additional `name` + `description` block on top of the
// schema body; we include the description (the LLM-visible name+description
// pair) so the per-tool token count reflects what is actually billed to the
// model. Update both sites in lockstep if a schema changes.
const FETCH_SCHEMA: unknown = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The webpage URL to fetch.' },
    timeout: { type: 'number', description: 'Optional timeout in ms (default 12000).' },
  },
  required: ['url'],
  additionalProperties: false,
};
const FETCH_META: { name: string; description: string } = {
  name: 'fetch',
  description:
    'Fetch a webpage and convert it to markdown. Use this to read the content of a web page when you have a URL. Returns the page title and content in markdown format.',
};

const DELETE_FILE_SCHEMA: unknown = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description:
        'Absolute path to the file to delete, for example /Users/xxx/project/src/example.ts',
    },
  },
  required: ['file_path'],
  additionalProperties: false,
};
const DELETE_FILE_META = {
  name: 'delete_file',
  description:
    'Delete a file inside the current project. Use absolute paths. Cannot delete directories, symlinks, or protected paths (.env, .git, node_modules, out, dist).',
};

const BASH_SCHEMA: unknown = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The bash command to execute' },
  },
  required: ['command'],
  additionalProperties: false,
};
const BASH_META = {
  name: 'bash',
  description:
    'Execute a bash command. Returns stdout, stderr, and exit code. Use this to run system commands, scripts, or interact with the file system. Only use for tasks that require shell commands.',
};

const KNOWLEDGE_SEARCH_SCHEMA: unknown = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    tagMatch: { type: 'string', enum: ['all', 'any'] },
    dateField: { type: 'string', enum: ['timestamp'] },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    sortBy: { type: 'string', enum: ['timestamp', 'title'] },
    sortOrder: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: 'number' },
  },
  additionalProperties: false,
};
const KNOWLEDGE_SEARCH_META = {
  name: 'knowledge_search',
  description:
    'Search project-local Knowledge Entries stored under .cdf/knowledge. Returns relative paths so you can read matching entries with read_file. Does not read, create, update, or delete entries.',
};

const KNOWLEDGE_CREATE_SCHEMA: unknown = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'OKF concept type. Defaults to Reference.' },
    title: { type: 'string', description: 'Knowledge Entry title.' },
    description: { type: 'string', description: 'Optional OKF description.' },
    resource: { type: 'string', description: 'Optional OKF resource URI, path, or identifier.' },
    authors: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
    journal: { type: 'string' },
    volume: { type: 'string' },
    issue: { type: 'string' },
    pages: { type: 'string' },
    year: { type: ['string', 'number'] },
    doi: { type: 'string' },
    journalMetrics: {
      type: 'object',
      properties: {
        impactFactor: { type: ['number', 'string'] },
        casTier: { type: 'string' },
        jcrQuartile: { type: 'string' },
        indexing: { type: 'array', items: { type: 'string' } },
        year: { type: ['number', 'string'] },
        source: { type: 'string' },
      },
      required: ['year', 'source'],
      additionalProperties: false,
    },
    body: { type: 'string', description: 'Markdown body content for the Knowledge Entry.' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for the Knowledge Entry.',
    },
    relativePath: {
      type: 'string',
      description: 'Optional Knowledge Base-relative .md path. If omitted, CDF generates one from title.',
    },
  },
  required: ['title', 'body'],
  additionalProperties: false,
};
const KNOWLEDGE_CREATE_META = {
  name: 'knowledge_create',
  description:
    'Create a project-local Knowledge Entry under .cdf/knowledge with managed OKF frontmatter, safe path handling, and collision protection. Does not update or delete entries.',
};

const TAVILY_SCHEMA: unknown = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    max_results: { type: 'number' },
  },
  required: ['query'],
};
const TAVILY_META = {
  name: 'tavily_search',
  description: 'Search the web using Tavily.',
};

const ANYSEARCH_SCHEMA: unknown = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    top_k: { type: 'number' },
  },
  required: ['query'],
};
const ANYSEARCH_META = {
  name: 'anysearch',
  description: 'Search using AnySearch.',
};

const ARXIV_SCHEMA: unknown = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    max_results: { type: 'number' },
  },
  required: ['query'],
};
const ARXIV_META = {
  name: 'arxiv_search',
  description: 'Search arxiv papers.',
};

const MANAGE_FLOW_DIAGRAM_SCHEMA: unknown = {
  type: 'object',
  properties: {
    action: { enum: ['read_format', 'create', 'get', 'edit', 'rollback', 'export'] },
    file_path: { type: 'string' },
    operations: { type: 'array' },
    format: { enum: ['png', 'svg'] },
    output_path: { type: 'string' },
  },
  required: ['action'],
};
const MANAGE_FLOW_DIAGRAM_META = {
  name: 'manage_flow_diagram',
  description: 'Create and safely manage Project-owned editable Excalidraw Flow Diagrams.',
};

const OBSCURA_BROWSE_META = {
  name: 'obscura_browse',
  description:
    'Render a browser-backed web page with Obscura and return extracted page content. Use this for pages that need JavaScript rendering or a browser environment. Besides page content, format also supports structured single-page reads: discovered links, the cookie jar, referenced asset URLs, and the raw unrendered response body.',
};
const OBSCURA_BROWSE_SCHEMA: unknown = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    format: { type: 'string', enum: ['markdown', 'text', 'html', 'links', 'cookies', 'assets', 'original'] },
    waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'] },
    selector: { type: 'string' },
  },
  required: ['url'],
};

const GENERATE_IMAGE_META = {
  name: 'generate_image',
  description:
    'Generate or edit an image. Text-to-image uses prompt only; image-to-image (edit) uses prompt plus input_images as source image references. Uses connected MiniMax Token Plan, Codex OAuth, or xAI Grok OAuth. Returns local artifact paths plus displayMarkdown.',
};
const GENERATE_IMAGE_SCHEMA: unknown = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    operation: { type: 'string', enum: ['generate', 'edit'] },
    route_hint: { type: 'string', enum: ['auto', 'minimax-token-plan', 'codex-oauth', 'xai-oauth'] },
    input_images: { type: 'array' },
    aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'] },
  },
  required: ['prompt'],
};

const GENERATE_VIDEO_META = {
  name: 'generate_video',
  description:
    'Queue explicit text-to-video or first-frame image-to-video generation through connected providers. Queued work has not incurred provider cost; the Project task panel reports the frozen route, mode, provider states, tracking controls, and final local MP4 artifact.',
};
const GENERATE_VIDEO_SCHEMA: unknown = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['text', 'first-frame'] },
    prompt: { type: 'string' },
    images: { type: 'array' },
    route_hint: { type: 'string', enum: ['auto', 'xai-oauth', 'minimax-token-plan'] },
    duration: { type: 'number' },
    aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
    resolution: { type: 'string', enum: ['480p', '720p', '768P', '1080P'] },
  },
  required: ['mode', 'prompt'],
};

const MANAGE_BACKGROUND_JOBS_META = {
  name: 'manage_background_jobs',
  description:
    'List or inspect Project background jobs, cancel queued work, stop/resume local tracking, or explicitly resubmit an unknown provider submission. Resubmission can create a duplicate charge.',
};
const MANAGE_BACKGROUND_JOBS_SCHEMA: unknown = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'get', 'cancel', 'stop_tracking', 'resume_tracking', 'resubmit'] },
    job_id: { type: 'string' },
  },
  required: ['action'],
};

const SYNTHESIZE_SPEECH_META = {
  name: 'synthesize_speech',
  description:
    'Synthesize speech from text using MiniMax Token Plan Speech 2.8 (speech-2.8-hd or speech-2.8-turbo only). Returns a local audio artifact path. Link it in your reply as [label](path) so the user can open the file. Prefer displayMarkdown from the tool result.',
};
const SYNTHESIZE_SPEECH_SCHEMA: unknown = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    model: { type: 'string', enum: ['speech-2.8-hd', 'speech-2.8-turbo'] },
    voice_id: { type: 'string' },
    speed: { type: 'number' },
    emotion: { type: 'string' },
  },
  required: ['text'],
};

const GENERATE_MUSIC_META = {
  name: 'generate_music',
  description:
    'Generate a song with MiniMax Token Plan music-3.0 only (not cover models). Provide prompt (style/mood) and lyrics (use \\n and structure tags like [verse]/[chorus]). For instrumental-only set is_instrumental=true. Returns a local audio path; include displayMarkdown or [title](path) in your reply.',
};
const GENERATE_MUSIC_SCHEMA: unknown = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    lyrics: { type: 'string' },
    model: { type: 'string', enum: ['music-3.0'] },
    is_instrumental: { type: 'boolean' },
  },
};

// Every tool createBuiltInTools() mounts unconditionally must appear here, or the
// system-prompt token estimate silently under-counts. A consistency test in
// context-aggregator.test.ts locks this set against createBuiltInTools.
const BUILTIN_TOOL_BUDGET: ReadonlyArray<{ meta: { name: string; description: string }; schema: unknown }> = [
  { meta: FETCH_META, schema: FETCH_SCHEMA },
  { meta: DELETE_FILE_META, schema: DELETE_FILE_SCHEMA },
  { meta: BASH_META, schema: BASH_SCHEMA },
  { meta: OBSCURA_BROWSE_META, schema: OBSCURA_BROWSE_SCHEMA },
  { meta: KNOWLEDGE_SEARCH_META, schema: KNOWLEDGE_SEARCH_SCHEMA },
  { meta: KNOWLEDGE_CREATE_META, schema: KNOWLEDGE_CREATE_SCHEMA },
  { meta: MANAGE_FLOW_DIAGRAM_META, schema: MANAGE_FLOW_DIAGRAM_SCHEMA },
  { meta: GENERATE_IMAGE_META, schema: GENERATE_IMAGE_SCHEMA },
  { meta: GENERATE_VIDEO_META, schema: GENERATE_VIDEO_SCHEMA },
  { meta: MANAGE_BACKGROUND_JOBS_META, schema: MANAGE_BACKGROUND_JOBS_SCHEMA },
  { meta: SYNTHESIZE_SPEECH_META, schema: SYNTHESIZE_SPEECH_SCHEMA },
  { meta: GENERATE_MUSIC_META, schema: GENERATE_MUSIC_SCHEMA },
  // Search tools are mounted conditionally by TOOL_REGISTRY when configured.
  { meta: TAVILY_META, schema: TAVILY_SCHEMA },
  { meta: ANYSEARCH_META, schema: ANYSEARCH_SCHEMA },
  { meta: ARXIV_META, schema: ARXIV_SCHEMA },
];

// Tool names always mounted by createBuiltInTools() (the unconditional builtins).
// Exported so a consistency test can assert BUILTIN_TOOL_BUDGET covers them.
export const UNCONDITIONAL_BUILTIN_TOOL_NAMES: readonly string[] = [
  'delete_file', 'bash', 'fetch', 'obscura_browse', 'knowledge_search', 'knowledge_create',
  'manage_flow_diagram', 'generate_image', 'generate_video', 'manage_background_jobs',
  'synthesize_speech', 'generate_music',
];

export const BUILTIN_TOOL_BUDGET_NAMES: readonly string[] = BUILTIN_TOOL_BUDGET.map((t) => t.meta.name);

// Pre-compute character length of every built-in tool's name+description+schema
// once at module load. Avoids re-serializing on every modal open.
export const BUILTIN_TOOL_CHARS: number = BUILTIN_TOOL_BUDGET.reduce((acc, t) => {
  return acc + t.meta.name.length + t.meta.description.length + safeStringifyLen(t.schema);
}, 0);

function safeStringifyLen(v: unknown): number {
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

/**
 * Aggregate token breakdown for the active session (D-07/D-08).
 * - Conversation: SUM(LENGTH(content)) FROM messages WHERE session_id = ?
 * - Skills:      sum SKILL.md file sizes for the project's physical skills
 * - MCP tools:   sum JSON.stringify(tool.schema || tool.inputSchema).length
 * - Workflows:   SUM(LENGTH(stages)) FROM workflows WHERE status = 'active' AND project_id = ?
 * - Project command bodies (08.2 P4 NEW, v1.1 real): sum .cdf/commands/*.md bytes × 0.25
 * - Per-MCP-tool (08.2 P4 NEW, v1.1 real): [{ tool, server, tokens }]
 * - System prompt / system tools / custom agents / memory files
 *   (08.2 P4 NEW, v1.1 placeholders — default 0; v1.2 推 per CONTEXT.md Issue 1)
 * - Autocompact buffer = Math.ceil(contextLimit * 0.15) (CDF 85% threshold)
 * - Free space = max(0, contextLimit - total - autocompactBuffer)
 *
 * Each source is wrapped in its own try-catch (PITFALLS P7-6). On failure,
 * only the failed source returns 0 — other sources still report real values.
 *
 * @param sessionId - active session id (validated, ≤ 64 chars)
 * @param contextLimit - optional override for the model's context limit
 *   (default: active provider's context_limit, fallback 200_000)
 */
export async function aggregateCurrentSessionContext(
  sessionId: string,
  contextLimit?: number,
  overriddenModelName?: string
): Promise<ContextAggregate> {
  // ASVS V5 input validation
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
    return {
      breakdown: { ...ZERO_BREAKDOWN },
      total: 0,
      modelName: '',
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      used: 0,
      usedPct: 0,
      freePct: 100,
      mcpPerTool: [],
    };
  }

  // Resolve contextLimit + modelName from the active provider (P10 — provider-specific).
  let resolvedLimit = DEFAULT_CONTEXT_LIMIT;
  let modelName = '';
  let agentIdForContext: string | undefined;
  let agentSystemPrompt: string | null = null;
  let projectName: string | undefined;
  let projectPathFromAgent: string | undefined;
  try {
    const session = db.prepare('SELECT project_id, prompt_snapshot FROM sessions WHERE id = ?')
      .get(sessionId) as { project_id: string; prompt_snapshot?: string | null } | undefined;
    if (session) {
      const projectScene = db.prepare('SELECT scene FROM projects WHERE id = ?').get(session.project_id) as { scene?: string | null } | undefined;
      const resolvedMaster = createAgentCatalog(db, { initializeSchema: false }).resolveMaster(projectScene?.scene ?? 'general');
      const master = resolvedMaster.agent;
      const configuredProvider = master.provider_id
        ? db.prepare(
          'SELECT context_limit, default_model AS model_name, name AS provider_name FROM llm_providers WHERE id = ? AND is_active = 1',
        ).get(master.provider_id) as { context_limit?: number; model_name?: string; provider_name?: string } | undefined
        : undefined;
      const activeProvider = db.prepare(
        'SELECT context_limit, default_model AS model_name, name AS provider_name FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1',
      ).get() as { context_limit?: number; model_name?: string; provider_name?: string } | undefined;
      const provider = configuredProvider ?? activeProvider ?? db.prepare(
        'SELECT context_limit, default_model AS model_name, name AS provider_name FROM llm_providers ORDER BY updated_at DESC LIMIT 1',
      ).get() as { context_limit?: number; model_name?: string; provider_name?: string } | undefined;

      if (typeof contextLimit === 'number' && Number.isFinite(contextLimit) && contextLimit > 0) {
        resolvedLimit = contextLimit;
      } else if (provider?.context_limit && provider.context_limit > 0) {
        resolvedLimit = provider.context_limit;
      }
      modelName = overriddenModelName || provider?.model_name || '';
      agentIdForContext = master.id;
      agentSystemPrompt = session.prompt_snapshot ?? resolvedMaster.system_prompt;
    }
  } catch (err) {
    log.warn('[context-aggregator] provider lookup failed, using default limit:', err);
    if (typeof contextLimit === 'number' && Number.isFinite(contextLimit) && contextLimit > 0) {
      resolvedLimit = contextLimit;
    }
  }

  // Pull project name + path for system-prompt size (mirrors
  // buildProjectContext in runtime.ts:296). This duplicates the lookup from
  // the "Skills" block below (which also queries projects) so we can run it
  // even when the Skills block fails.
  try {
    const proj = db
      .prepare(
        `SELECT p.name, p.path FROM projects p
         JOIN sessions s ON s.project_id = p.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { name: string; path: string } | undefined;
    if (proj) {
      projectName = proj.name;
      projectPathFromAgent = proj.path;
    }
  } catch {
    // non-fatal — systemPrompt will fall back to agent-only length
  }

  // 1. Conversation tokens (try-catch #1)
  let conversation = 0;
  try {
    const row = db
      .prepare('SELECT COALESCE(SUM(LENGTH(content)), 0) AS total FROM messages WHERE session_id = ?')
      .get(sessionId) as { total: number } | undefined;
    conversation = safeMath(row?.total || 0);
  } catch (err) {
    log.warn('[context-aggregator] conversation failed:', err);
  }

  // 2. Skills tokens (try-catch #2) — populates skillsPerSkill breakdown.
  // Consume the same resolved CDF Skills runtime as Chat / worker / workflow
  // paths so Scene exposure and preload semantics are accounted once.
  let skills = 0;
  let projectPath: string | undefined;
  let skillsPerSkill: SkillDetail[] = [];
  try {
    const project = db
      .prepare(
        `SELECT p.id AS project_id, p.path, p.scene FROM projects p
         JOIN sessions s ON s.project_id = p.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { project_id: string; path: string; scene?: 'general' | 'research' } | undefined;

    if (project?.path) {
      projectPath = project.path;
      let preloadSkillNames: string[] = [];
      if (agentIdForContext) {
        const rows = db
          .prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?')
          .all(agentIdForContext) as Array<{ skill_name: string }>;
        preloadSkillNames = skillReferencesToPreloadNames(rows.map((row) => row.skill_name));
      }
      const skillSnapshot = getOrCaptureConversationSystemContextSnapshot(db, {
        sessionId,
        projectPath,
        sceneId: project.scene ?? 'general',
        promptSnapshot: createAgentCatalog(db, { initializeSchema: false }).resolveMaster(project.scene ?? 'general').system_prompt,
      }).skillSnapshot;
      const skillsRuntime = buildProjectSkillsRuntime(projectPath, {
        catalog: skillSnapshot as ResolvedSkillCatalogEntry[],
        preloadSkillNames,
      });
      for (const warning of skillsRuntime.warnings) {
        log.warn('[context-aggregator] Ignored invalid Skill runtime input:', warning);
      }
      let skillsChars = 0;
      for (const skill of skillsRuntime.skills) {
        const { chars, preloaded } = estimateResolvedSkillContextChars(skill, preloadSkillNames);
        if (chars <= 0) continue;
        skillsChars += chars;
        skillsPerSkill.push({
          name: getSkillDisplayName(skill),
          scope: getSkillScope(skill),
          tokens: safeMath(chars),
          sourceLabel: getSkillSourceLabel(skill),
          preloaded,
        });
      }
      skills = safeMath(skillsChars);
      // Sort by tokens desc so the heaviest skills appear first
      skillsPerSkill.sort((a, b) => b.tokens - a.tokens);
    }
  } catch (err) {
    log.warn('[context-aggregator] skills failed:', err);
  }

  // 3. MCP tools tokens (try-catch #3) — also populates mcpPerTool (#4)
  let mcp = 0;
  let mcpPerTool: MCPToolDetail[] = [];
  let connectedServers: MCPServer[] = [];
  try {
    if (agentIdForContext) {
      connectedServers = getAgentMcpServers(agentIdForContext);
      const result = await loadMcpTools(agentIdForContext, connectedServers, getConnectedMcpServers());
      let mcpChars = 0;
      for (const tool of result.tools) {
        const t = tool as { name?: string; schema?: unknown; inputSchema?: unknown };
        const schemaJson = (t.schema ?? t.inputSchema ?? {}) as unknown;
        let schemaLen = 0;
        try {
          schemaLen = JSON.stringify(schemaJson).length;
        } catch {
          // skip non-serializable tools
        }
        mcpChars += schemaLen;
        // Per-MCP-tool breakdown (v1.1 real). Best-effort: assign to first
        // connected server since MultiServerMCPClient.getTools() flattens;
        // server attribution is approximate for multi-server setups.
        const toolName = t.name || 'unnamed';
        const tokens = safeMath(schemaLen);
        mcpPerTool.push({
          tool: toolName,
          server: connectedServers[0]?.name || 'unknown',
          tokens,
        });
      }
      mcp = safeMath(mcpChars);
    }
  } catch (err) {
    log.warn('[context-aggregator] mcp failed:', err);
  }

  // 4. Workflows tokens (try-catch #4) — populates workflowsPerWorkflow breakdown
  let workflows = 0;
  let workflowsPerWorkflow: WorkflowDetail[] = [];
  try {
    const rows = db
      .prepare(
        `SELECT id, name, LENGTH(stages) AS len
         FROM workflows
         WHERE status = 'active' AND project_id = (
           SELECT project_id FROM sessions WHERE id = ?
         )`
      )
      .all(sessionId) as Array<{ id: string; name: string; len: number }>;
    let totalChars = 0;
    for (const r of rows) {
      const tokens = safeMath(r.len);
      totalChars += r.len;
      workflowsPerWorkflow.push({ id: r.id, name: r.name, tokens });
    }
    workflows = safeMath(totalChars);
    // Sort by tokens desc
    workflowsPerWorkflow.sort((a, b) => b.tokens - a.tokens);
  } catch (err) {
    log.warn('[context-aggregator] workflows failed:', err);
  }

  // 5. Project command bodies (08.2 P4 NEW — v1.1 real)
  //     C2-01 11-category spec: sum .cdf/commands/*.md bytes × 0.25.
  //     08.2 polish: also populate per-file breakdown.
  let projectCommandBodies = 0;
  let projectCommandsPerFile: ProjectCommandDetail[] = [];
  try {
    if (projectPath) {
      const cmdsDir = path.join(projectPath, '.cdf', 'commands');
      if (fs.existsSync(cmdsDir)) {
        let totalBytes = 0;
        for (const file of fs.readdirSync(cmdsDir).filter((f) => f.endsWith('.md'))) {
          const size = safeFileSize(path.join(cmdsDir, file));
          totalBytes += size;
          projectCommandsPerFile.push({ name: file, tokens: safeMath(size) });
        }
        projectCommandBodies = safeMath(totalBytes);
        projectCommandsPerFile.sort((a, b) => b.tokens - a.tokens);
      }
    }
  } catch (err) {
    log.warn('[context-aggregator] projectCommandBodies failed:', err);
  }

  // 6. systemPrompt (08.2 polish — promoted to real calculation).
  //     runtime.ts:486 builds: (agents.system_prompt || '') + buildProjectContext(project)
  //     We replicate the same two-part sum so the modal reports what the
  //     LLM actually sees in the system-prompt slot.
  let systemPrompt = 0;
  try {
    const agentPromptChars = (agentSystemPrompt || '').length;
    const projectCtxChars = projectName && projectPathFromAgent
      ? buildProjectContextString(projectName, projectPathFromAgent).length
      : 0;
    systemPrompt = safeMath(agentPromptChars + projectCtxChars);
  } catch (err) {
    log.warn('[context-aggregator] systemPrompt failed:', err);
  }

  // 7. systemTools (08.2 polish — promoted to real calculation).
  //     runtime.ts mounts a fixed array of built-in tools into
  //     every agent regardless of MCP Server Exclusions or Skill Preload selections:
  //       [fetch, delete_file (plan-mode stripped), bash (plan-mode stripped),
  //        knowledge_search, knowledge_create,
  //        tavily / anysearch / arxiv (tool_configs.is_enabled=1 only)]
  //     We sum the character length of name+description+schema for all mirrored
  //     built-ins here; plan-mode strips only the write/shell tools.
  //     08.2 polish: also populate per-tool breakdown.
  let systemTools = 0;
  let systemToolsPerTool: SystemToolDetail[] = [];
  try {
    let totalChars = 0;
    for (const t of BUILTIN_TOOL_BUDGET) {
      const chars = t.meta.name.length + t.meta.description.length + safeStringifyLen(t.schema);
      totalChars += chars;
      systemToolsPerTool.push({ name: t.meta.name, tokens: safeMath(chars) });
    }
    systemTools = safeMath(totalChars);
    systemToolsPerTool.sort((a, b) => b.tokens - a.tokens);
  } catch (err) {
    log.warn('[context-aggregator] systemTools failed:', err);
  }

  // 8. customAgents (08.2 P4 — v1.1 PLACEHOLDER, v1.2 推).
  //     deepagent runtime does not expose sub-agent definitions in a
  //     queryable form; they live in the runtime's compiled closure.
  let customAgents = 0;

  // 9. memoryFiles (08.2 P4 — v1.1 PLACEHOLDER, v1.2 推).
  //     The CLAUDE.md / MEMORY.md source system is not implemented.
  let memoryFiles = 0;

  // 10. messages — alias of conversation (Claude Code parity)
  const messages = conversation;

  // 11. autocompactBuffer + freeSpace (computed, NOT counted in total)
  const autocompactBuffer = Math.ceil(resolvedLimit * 0.15);
  const total =
    conversation +
    skills +
    mcp +
    workflows +
    projectCommandBodies +
    systemPrompt +
    systemTools +
    customAgents +
    memoryFiles;
  const freeSpace = Math.max(0, resolvedLimit - total - autocompactBuffer);
  const usedPct = Math.min(100, Math.round((total / resolvedLimit) * 100));
  const freePct = Math.round((freeSpace / resolvedLimit) * 100);

  return {
    breakdown: {
      conversation,
      skills,
      mcp,
      workflows,
      systemPrompt,
      systemTools,
      customAgents,
      memoryFiles,
      messages,
      projectCommandBodies,
      freeSpace,
      autocompactBuffer,
      mcpPerTool,
      skillsPerSkill,
      workflowsPerWorkflow,
      systemToolsPerTool,
      projectCommandsPerFile,
    },
    total,
    modelName,
    contextLimit: resolvedLimit,
    used: total,
    usedPct,
    freePct,
    mcpPerTool,
  };
}
