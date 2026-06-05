// D-07/D-08/D-09: Aggregate token breakdown for the current session's loaded context.
// Data sources: conversation (messages table), skills (listPhysicalSkills),
// MCP tools (loadMcpTools), workflows (workflows table graph_data).
// Token heuristic: Math.ceil(chars * 0.25) — OpenAI rough 1 token ≈ 4 chars.
// Per-source try-catch: if one source fails, the others still report real values.
//
// 08.2 P4 C2-01: extended to 11 categories + per-MCP-tool breakdown +
// autocompact buffer (context_limit × 15%, CDF 85% threshold) + free space.
// 7 of 11 are real calculations; 4 are v1.1 placeholders defaulting to 0
// (systemPrompt / systemTools / customAgents / memoryFiles) — deferred to
// v1.2+ per CONTEXT.md Issue 1.

import fs from 'fs';
import os from 'os';
import path from 'path';
import db from '../database';
import { listPhysicalSkills, getScopePath } from './skill-manager';
import { loadMcpTools } from './mcp-connector';
import type { MCPServer } from '../../shared/types';

export interface MCPToolDetail {
  tool: string;
  server: string;
  tokens: number;
}

export interface ContextBreakdown {
  // Original 4 (Phase 7) — kept for back-compat
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
  // 08.2 P4 NEW — 7 of 11 are real calculations (per CONTEXT.md C2-01 / Issue 1):
  systemPrompt: number;          // v1.1 placeholder — default 0 (v1.2 推)
  systemTools: number;           // v1.1 placeholder — default 0 (v1.2 推)
  customAgents: number;          // v1.1 placeholder — default 0 (v1.2 推)
  memoryFiles: number;           // v1.1 placeholder — default 0 (v1.2 推)
  messages: number;              // alias of conversation (Claude Code parity)
  projectCommandBodies: number;  // v1.1 real — sum .cdf/commands/*.md bytes × 0.25
  // 08.2 P4 NEW — computed totals:
  freeSpace: number;             // max(0, contextLimit - total - autocompactBuffer)
  autocompactBuffer: number;     // Math.ceil(contextLimit * 0.15)
  mcpPerTool: MCPToolDetail[];   // v1.1 real — per-tool breakdown (expandable in modal)
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
  // v1.1 placeholders (Issue 1):
  systemPrompt: 0,
  systemTools: 0,
  customAgents: 0,
  memoryFiles: 0,
  messages: 0,
  projectCommandBodies: 0,
  // computed:
  freeSpace: 0,
  autocompactBuffer: 0,
  mcpPerTool: [],
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
  contextLimit?: number
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
  try {
    if (typeof contextLimit === 'number' && Number.isFinite(contextLimit) && contextLimit > 0) {
      resolvedLimit = contextLimit;
    } else {
      // Look up the session's agent → active provider
      const agent = db
        .prepare(
          `SELECT a.id, a.model, a.provider_id, p.context_limit, p.name AS provider_name
           FROM agents a
           JOIN sessions s ON s.agent_id = a.id
           JOIN llm_providers p ON p.id = a.provider_id AND p.is_active = 1
           WHERE s.id = ?`
        )
        .get(sessionId) as
        | { id: string; model: string; provider_id: string; context_limit: number; provider_name: string }
        | undefined;
      if (agent?.context_limit && agent.context_limit > 0) {
        resolvedLimit = agent.context_limit;
      }
      modelName = agent?.model || '';
    }
  } catch (err) {
    console.warn('[context-aggregator] provider lookup failed, using default limit:', err);
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

  // 2. Skills tokens (try-catch #2)
  let skills = 0;
  let projectPath: string | undefined;
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
        // skill.scope is 'global' | 'project'
        const baseDir =
          skill.scope === 'global'
            ? getScopePath(projectPath, 'global')
            : getScopePath(projectPath, 'project');
        const skillMdPath = path.join(baseDir, skill.name, 'SKILL.md');
        skillsChars += safeFileSize(skillMdPath);
      }
      skills = safeMath(skillsChars);
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

  // 4. Workflows tokens (try-catch #4)
  let workflows = 0;
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(graph_data)), 0) AS total
         FROM workflows
         WHERE status = 'active' AND project_id = (
           SELECT project_id FROM sessions WHERE id = ?
         )`
      )
      .get(sessionId) as { total: number } | undefined;
    workflows = safeMath(row?.total || 0);
  } catch (err) {
    console.warn('[context-aggregator] workflows failed:', err);
  }

  // 5. Project command bodies (08.2 P4 NEW — v1.1 real)
  //     C2-01 11-category spec: sum .cdf/commands/*.md bytes × 0.25.
  let projectCommandBodies = 0;
  try {
    if (projectPath) {
      const cmdsDir = path.join(projectPath, '.cdf', 'commands');
      if (fs.existsSync(cmdsDir)) {
        let totalBytes = 0;
        for (const file of fs.readdirSync(cmdsDir).filter((f) => f.endsWith('.md'))) {
          totalBytes += safeFileSize(path.join(cmdsDir, file));
        }
        projectCommandBodies = safeMath(totalBytes);
      }
    }
  } catch (err) {
    console.warn('[context-aggregator] projectCommandBodies failed:', err);
  }

  // 6. systemPrompt (08.2 P4 NEW — v1.1 PLACEHOLDER, v1.2 推)
  //     CONTEXT.md Issue 1: v1.1 phase best-effort; default 0.
  //     No source for the LLM's actual system prompt is exposed in v1.1.
  let systemPrompt = 0;
  console.warn(
    '[context-aggregator] systemPrompt 估算未实现 - default 0（v1.2 推）'
  );

  // 7. systemTools (08.2 P4 NEW — v1.1 PLACEHOLDER, v1.2 推)
  //     CONTEXT.md Issue 1: built-in tool schema enumeration is deepagent-runtime
  //     internal; v1.1 defaults to 0.
  let systemTools = 0;
  console.warn(
    '[context-aggregator] systemTools 估算未实现 - default 0（v1.2 推）'
  );

  // 8. customAgents (08.2 P4 NEW — v1.1 PLACEHOLDER, v1.2 推)
  //     CONTEXT.md Issue 1: subagent definitions are not exposed in v1.1.
  let customAgents = 0;
  console.warn(
    '[context-aggregator] customAgents 估算未实现 - default 0（v1.2 推）'
  );

  // 9. memoryFiles (08.2 P4 NEW — v1.1 PLACEHOLDER, v1.2 推)
  //     CONTEXT.md Issue 1: MEMORY.md / CLAUDE.md sources not implemented.
  let memoryFiles = 0;
  console.warn(
    '[context-aggregator] memoryFiles 估算未实现 - default 0（v1.2 推）'
  );

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
    memoryFiles +
    messages;
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
