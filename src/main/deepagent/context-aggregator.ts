// D-07/D-08/D-09: Aggregate token breakdown for the current session's loaded context.
// Data sources: conversation (messages table), skills (listPhysicalSkills),
// MCP tools (loadMcpTools), workflows (workflows table graph_data).
// Token heuristic: Math.ceil(chars * 0.25) — OpenAI rough 1 token ≈ 4 chars.
// Per-source try-catch: if one source fails, the others still report real values.

import fs from 'fs';
import os from 'os';
import path from 'path';
import db from '../database';
import { listPhysicalSkills, getScopePath } from './skill-manager';
import { loadMcpTools } from './mcp-connector';
import type { MCPServer } from '../../shared/types';

export interface ContextBreakdown {
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
}

export interface ContextAggregate {
  breakdown: ContextBreakdown;
  total: number;
}

const ZERO_BREAKDOWN: ContextBreakdown = { conversation: 0, skills: 0, mcp: 0, workflows: 0 };

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
 * Aggregate token breakdown for the active session (D-07/D-08).
 * - Conversation: SUM(LENGTH(content)) FROM messages WHERE session_id = ?
 * - Skills:      sum SKILL.md file sizes for the project's physical skills
 * - MCP tools:   sum JSON.stringify(tool.schema || tool.inputSchema).length
 * - Workflows:   SUM(LENGTH(graph_data)) FROM workflows WHERE status = 'active' AND project_id = ?
 *
 * Each source is wrapped in its own try-catch (PITFALLS P7-6). On failure,
 * only the failed source returns 0 — other sources still report real values.
 */
export async function aggregateCurrentSessionContext(sessionId: string): Promise<ContextAggregate> {
  // ASVS V5 input validation
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
    return { breakdown: { ...ZERO_BREAKDOWN }, total: 0 };
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
  try {
    const project = db
      .prepare(
        `SELECT p.path FROM projects p
         JOIN sessions s ON s.project_id = p.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { path: string } | undefined;

    if (project?.path) {
      const projectPath = project.path;
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

  // 3. MCP tools tokens (try-catch #3)
  let mcp = 0;
  try {
    const agent = db
      .prepare(
        `SELECT a.id FROM agents a
         JOIN sessions s ON s.agent_id = a.id
         WHERE s.id = ?`
      )
      .get(sessionId) as { id: string } | undefined;

    if (agent?.id) {
      const mcpServers = db
        .prepare('SELECT * FROM mcp_servers WHERE is_connected = 1')
        .all() as MCPServer[];
      const result = await loadMcpTools(agent.id, mcpServers);
      let mcpChars = 0;
      for (const tool of result.tools) {
        const t = tool as { schema?: unknown; inputSchema?: unknown };
        const schemaJson = (t.schema ?? t.inputSchema ?? {}) as unknown;
        try {
          mcpChars += JSON.stringify(schemaJson).length;
        } catch {
          // skip non-serializable tools
        }
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

  const total = conversation + skills + mcp + workflows;
  return {
    breakdown: { conversation, skills, mcp, workflows },
    total,
  };
}
