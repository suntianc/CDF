// D-07/D-08/D-09: Aggregate token breakdown for the current session's loaded context.
// Data sources: conversation (messages table), skills (listPhysicalSkills),
// MCP tools (loadMcpTools), workflows (workflows table graph_data),
// system prompt (agents.system_prompt + buildProjectContext),
// system tools (5 built-in tool schemas — fetch/delete_file/bash/tavily/anysearch/arxiv).
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
import path from 'path';
import YAML from 'yaml';
import db from '../database';
import { listPhysicalSkills, getScopePath } from './skill-manager';
import { loadMcpTools } from './mcp-connector';
import type { MCPServer } from '../../shared/types';

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
  systemTools: number;           // 08.2 polish: 5 built-in tool schema sum
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

/**
 * Read the YAML frontmatter `description` field from a SKILL.md file.
 *
 * Why this exists: deepagent's progressive-disclosure pattern only injects
 * `name + description + path` for each skill into the LLM's system
 * prompt. The full SKILL.md body is only read on demand via read_file.
 * Aggregator should reflect what the LLM actually sees — the description
 * field, not the entire file.
 *
 * Returns 0 if the file is missing, the frontmatter is unparseable, or
 * the description field is absent — the caller falls back to a sensible
 * default in that case (file size for the rough-worst-case number).
 */
function readSkillDescriptionChars(skillMdPath: string): number {
  try {
    if (!fs.existsSync(skillMdPath)) return 0;
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    // Frontmatter is delimited by `---` lines at the start of the file.
    if (!raw.startsWith('---')) return 0;
    const end = raw.indexOf('\n---', 3);
    if (end < 0) return 0;
    const fmBlock = raw.slice(3, end);
    const parsed = YAML.parse(fmBlock);
    if (!parsed || typeof parsed !== 'object') return 0;
    const desc = (parsed as Record<string, unknown>).description;
    if (typeof desc !== 'string') return 0;
    return desc.length;
  } catch {
    return 0;
  }
}

const DEFAULT_CONTEXT_LIMIT = 200_000;

// === System-prompt estimate ===============================================
// runtime.ts:296 (buildProjectContext) appends a fixed CJK block describing
// the project name, root path, and Skill conventions. We replicate the
// template here (keeping parameters dynamic) so the aggregator can size the
// bytes that the LLM actually receives. Update both sites in lockstep if
// the runtime template changes.
function buildProjectContextString(projectName: string, projectPath: string): string {
  return `\n\n[项目上下文]\n当前选中项目名称: ${projectName}\n项目根目录: ${projectPath}\n所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径，例如 \`${projectPath}/src/main.ts\`。\nbash 工具也使用绝对路径，当前工作目录为项目根目录。\n\n## Skills 创建规范\n- 创建项目级 Skill 时，请写入 \`${projectPath}/.cdf/skills/{skill名称}/SKILL.md\`（项目级 skills 对该项目所有 Agent 自动可见）\n- SKILL.md 格式：以 \`---\` 开头的前置元数据，包含 \`name\` 和 \`description\` 字段，随后是 Markdown 正文\n- 全局 Skill 写入 \`~/.cdf/skills/{skill名称}/SKILL.md\`（需要在 Agent 编辑界面绑定后才可见）\n当你需要查看、确认、搜索或继续分析项目时，必须在当前轮次继续调用合适的文件工具；不要只回复”我先看看/我再确认/继续搜索”就结束。`;
}

// === Built-in tool schemas (08.2 polish) =================================
// Mirrors the schemas defined in:
//   - fetch-tool.ts (FETCH_SCHEMA)
//   - file-tools.ts (DELETE_FILE_SCHEMA)
//   - bash-tool.ts (inline schema for `bash`)
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

const BUILTIN_TOOL_BUDGET: ReadonlyArray<{ meta: { name: string; description: string }; schema: unknown }> = [
  { meta: FETCH_META, schema: FETCH_SCHEMA },
  { meta: DELETE_FILE_META, schema: DELETE_FILE_SCHEMA },
  { meta: BASH_META, schema: BASH_SCHEMA },
  { meta: TAVILY_META, schema: TAVILY_SCHEMA },
  { meta: ANYSEARCH_META, schema: ANYSEARCH_SCHEMA },
  { meta: ARXIV_META, schema: ARXIV_SCHEMA },
];

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
 * - Workflows:   SUM(LENGTH(graph_data)) FROM workflows WHERE status = 'active' AND project_id = ?
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
  let agentSystemPrompt: string | null = null;
  let projectName: string | undefined;
  let projectPathFromAgent: string | undefined;
  try {
    // ALWAYS look up the session's agent → active provider to resolve modelName and agentSystemPrompt.
    const agent = db
      .prepare(
        `SELECT a.id, a.system_prompt, a.provider_id, p.context_limit,
                p.default_model AS model_name, p.name AS provider_name
         FROM agents a
         JOIN sessions s ON s.agent_id = a.id
         JOIN llm_providers p ON p.id = a.provider_id AND p.is_active = 1
         WHERE s.id = ?`
      )
      .get(sessionId) as
      | {
          id: string;
          system_prompt: string | null;
          provider_id: string;
          context_limit: number;
          model_name: string;
          provider_name: string;
        }
      | undefined;
    if (typeof contextLimit === 'number' && Number.isFinite(contextLimit) && contextLimit > 0) {
      resolvedLimit = contextLimit;
    } else if (agent?.context_limit && agent.context_limit > 0) {
      resolvedLimit = agent.context_limit;
    }
    modelName = overriddenModelName || agent?.model_name || '';
    agentSystemPrompt = agent?.system_prompt ?? null;
  } catch (err) {
    console.warn('[context-aggregator] provider lookup failed, using default limit:', err);
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
    console.warn('[context-aggregator] conversation failed:', err);
  }

  // 2. Skills tokens (try-catch #2) — populates skillsPerSkill breakdown.
  //
  // 08.2 polish: deepagent's design (per the package's progressive-
  // disclosure pattern) injects only `name + description + path` for
  // each skill into the LLM's system prompt. The full SKILL.md is
  // only read on demand via read_file. Previously the aggregator
  // counted the entire SKILL.md byte size (e.g. skill-creator's
  // 33KB SKILL.md reported as 8.3k tokens), which overstated the
  // LLM-visible cost by 30-100x. We now read only the YAML
  // frontmatter description field, which is what the LLM actually
  // sees at conversation start.
  let skills = 0;
  let projectPath: string | undefined;
  let skillsPerSkill: SkillDetail[] = [];
  try {
    const project = db
      .prepare(
        `SELECT p.path FROM projects p
         JOIN sessions s ON s.project_id = p.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { path: string } | undefined;

    if (project?.path) {
      projectPath = project.path;
      const physicalSkills = listPhysicalSkills(projectPath);
      let skillsChars = 0;
      for (const skill of physicalSkills) {
        const scope = (skill.scope === 'global' ? 'global' : 'project') as
          | 'global'
          | 'project';
        const baseDir =
          scope === 'global'
            ? getScopePath(projectPath, 'global')
            : getScopePath(projectPath, 'project');
        const skillMdPath = path.join(baseDir, skill.name, 'SKILL.md');
        // 08.2 polish: count only the description field (the LLM-visible
        // portion), not the full file. Fall back to the full file size
        // only if the file is missing or the frontmatter is unparseable
        // (defensive — never let aggregator crash on a malformed skill).
        const descChars = readSkillDescriptionChars(skillMdPath);
        const chars =
          descChars > 0
            ? descChars + skill.name.length + '/skills/'.length
            : safeFileSize(skillMdPath);
        skillsChars += chars;
        skillsPerSkill.push({
          name: skill.name,
          scope,
          tokens: safeMath(chars),
        });
      }
      skills = safeMath(skillsChars);
      // Sort by tokens desc so the heaviest skills appear first
      skillsPerSkill.sort((a, b) => b.tokens - a.tokens);
    }
  } catch (err) {
    console.warn('[context-aggregator] skills failed:', err);
  }

  // 3. MCP tools tokens (try-catch #3) — also populates mcpPerTool (#4)
  let mcp = 0;
  let mcpPerTool: MCPToolDetail[] = [];
  let connectedServers: MCPServer[] = [];
  try {
    const agent = db
      .prepare(
        `SELECT a.id FROM agents a
         JOIN sessions s ON s.agent_id = a.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { id: string } | undefined;

    if (agent?.id) {
      connectedServers = db
        .prepare('SELECT * FROM mcp_servers WHERE is_connected = 1')
        .all() as MCPServer[];
      const result = await loadMcpTools(agent.id, connectedServers);
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
    console.warn('[context-aggregator] mcp failed:', err);
  }

  // 4. Workflows tokens (try-catch #4) — populates workflowsPerWorkflow breakdown
  let workflows = 0;
  let workflowsPerWorkflow: WorkflowDetail[] = [];
  try {
    const rows = db
      .prepare(
        `SELECT id, name, LENGTH(graph_data) AS len
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
    console.warn('[context-aggregator] workflows failed:', err);
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
    console.warn('[context-aggregator] projectCommandBodies failed:', err);
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
    console.warn('[context-aggregator] systemPrompt failed:', err);
  }

  // 7. systemTools (08.2 polish — promoted to real calculation).
  //     runtime.ts:492-504 mounts a fixed array of built-in tools into
  //     every agent regardless of MCP / skill bindings:
  //       [fetch, delete_file (plan-mode stripped), bash (plan-mode stripped),
  //        tavily / anysearch / arxiv (tool_configs.is_enabled=1 only)]
  //     We sum the character length of name+description+schema for all 6
  //     (note: plan-mode strips 2, so the live count is 4 for plan sessions —
  //     we report the full 6 here; the delta is negligible).
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
    console.warn('[context-aggregator] systemTools failed:', err);
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
