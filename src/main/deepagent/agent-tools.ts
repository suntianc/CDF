/**
 * Agent 管理工具 — Master Agent 可调用的 agent 增删改查工具
 *
 * 暴露给主对话,让 Master Agent 能:
 * - 列出当前项目的 agent
 * - 创建新 agent(包含挂载 MCP server / skill)
 * - 更新已有 agent
 * - 删除 agent
 *
 * 设计原则(参考 createWorkflowTools):
 * - 闭包注入 projectId,不允许工具跨项目操作
 * - 复用 db.* 表;与 AgentEditDialog 走同一条 schema 校验
 * - 错误以 JSON.stringify 形式返回给模型,而不是抛异常
 *   (LangChain tool 抛异常会触发 recover middleware,体感更差)
 */

import { randomUUID } from 'crypto';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';

const AGENT_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  provider_id: string | null;
  system_prompt: string | null;
  config: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function serializeAgent(row: AgentRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    provider_id: row.provider_id,
    system_prompt: row.system_prompt,
    config: parseConfig(row.config),
    is_default: row.is_default === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getMcpIdsForAgent(agentId: string): string[] {
  return (
    db
      .prepare('SELECT mcp_server_id FROM agent_mcp_servers WHERE agent_id = ?')
      .all(agentId) as { mcp_server_id: string }[]
  ).map((r) => r.mcp_server_id);
}

function getSkillNamesForAgent(agentId: string): string[] {
  return (
    db
      .prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?')
      .all(agentId) as { skill_name: string }[]
  ).map((r) => r.skill_name);
}

/**
 * 创建一个 Master Agent 工具集(4 个工具),闭包注入 projectId。
 */
export function createAgentTools(projectId: string) {
  return [
    // ---------- 1. 列出当前项目的 agent ----------
    tool(
      async () => {
        const rows = db
          .prepare(
            'SELECT * FROM agents WHERE project_id = ? ORDER BY is_default DESC, updated_at DESC',
          )
          .all(projectId) as AgentRow[];
        return JSON.stringify(
          rows.map((row) => {
            const base = serializeAgent(row);
            return {
              ...base,
              mcpServerIds: getMcpIdsForAgent(row.id),
              skillNames: getSkillNamesForAgent(row.id),
            };
          }),
        );
      },
      {
        name: 'list_agents',
        description:
          '列出当前项目下所有 agent。返回每个 agent 的 id、name、description、provider_id、system_prompt、config、mcpServerIds、skillNames、is_default 等完整信息。',
        schema: z.object({}),
      },
    ),

    // ---------- 2. 创建新 agent ----------
    tool(
      async (input: {
        name: string;
        description?: string;
        provider_id?: string | null;
        system_prompt?: string;
        mcpServerIds?: string[];
        skillNames?: string[];
        is_default?: boolean;
        config?: Record<string, unknown>;
      }) => {
        if (!input.name || !AGENT_NAME_REGEX.test(input.name.trim())) {
          return JSON.stringify({
            error:
              'Invalid agent name. Must contain only English letters, numbers, spaces, hyphens, or underscores.',
          });
        }

        // provider 必填语义:workflow 后续 getProvider(null) 会抛错,
        // 工具兜底:省略时回退到第一个可用 provider;没有 provider 则拒绝。
        let effectiveProviderId = input.provider_id ?? null;
        if (!effectiveProviderId) {
          const firstProvider = db
            .prepare('SELECT id FROM llm_providers ORDER BY id LIMIT 1')
            .get() as { id: string } | undefined;
          if (!firstProvider) {
            return JSON.stringify({
              error:
                'No LLM provider configured. The user must add one in Settings before creating agents, or pass provider_id explicitly.',
            });
          }
          effectiveProviderId = firstProvider.id;
        } else {
          const provider = db
            .prepare('SELECT id FROM llm_providers WHERE id = ?')
            .get(effectiveProviderId);
          if (!provider) {
            return JSON.stringify({
              error: `Provider not found: ${input.provider_id}. Use list_agents or settings to find valid provider IDs.`,
            });
          }
        }

        const id = randomUUID();
        const now = Date.now();
        const configStr = input.config ? JSON.stringify(input.config) : null;

        const runTx = db.transaction(() => {
          if (input.is_default) {
            db.prepare(
              'UPDATE agents SET is_default = 0, updated_at = ? WHERE project_id = ?',
            ).run(now, projectId);
          }
          db.prepare(
            `INSERT INTO agents
              (id, project_id, name, description, provider_id, system_prompt, config, is_default, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            projectId,
            input.name.trim(),
            input.description ?? null,
            effectiveProviderId,
            input.system_prompt ?? null,
            configStr,
            input.is_default ? 1 : 0,
            now,
            now,
          );

          if (Array.isArray(input.mcpServerIds)) {
            const insertMcp = db.prepare(
              'INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES (?, ?)',
            );
            // mcp_servers is a global table (no project_id column per
            // database.ts:139-148), so we only validate the server exists.
            for (const mcpId of input.mcpServerIds) {
              const exists = db
                .prepare('SELECT id FROM mcp_servers WHERE id = ?')
                .get(mcpId);
              if (exists) insertMcp.run(id, mcpId);
            }
          }

          if (Array.isArray(input.skillNames)) {
            const insertSkill = db.prepare(
              'INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, ?)',
            );
            for (const skillId of input.skillNames) {
              // 与 db:saveAgent 保持一致:仅保留 global scope 的 skill
              const scope = skillId.includes(':') ? skillId.split(':', 1)[0] : 'project';
              if (scope === 'global') insertSkill.run(id, skillId);
            }
          }
        });

        try {
          runTx();
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
        return JSON.stringify({
          ...serializeAgent(row),
          mcpServerIds: getMcpIdsForAgent(id),
          skillNames: getSkillNamesForAgent(id),
        });
      },
      {
        name: 'create_agent',
        description:
          '在当前项目下创建一个新 agent。可选挂载 MCP server (mcpServerIds)、skill (skillNames)、关联 provider。' +
          'name 必须是英文/数字/空格/连字符/下划线。is_default 只能同时有一个 agent 拥有,设置后其他 agent 自动取消默认。' +
          '返回创建成功的 agent 完整信息(含生成的 id)。',
        schema: z.object({
          name: z.string().describe('agent 名称(英文/数字/空格/-/_)'),
          description: z.string().optional().describe('agent 用途描述'),
          provider_id: z
            .string()
            .nullable()
            .optional()
            .describe('关联的 LLM provider ID(可选)'),
          system_prompt: z.string().optional().describe('agent 的系统提示词'),
          mcpServerIds: z
            .array(z.string())
            .optional()
            .describe('挂载的 MCP server ID 列表(可选)'),
          skillNames: z.array(z.string()).optional().describe('挂载的 skill 名称列表(可选)'),
          is_default: z
            .boolean()
            .optional()
            .describe('是否设为项目默认 agent(同时只能有一个)'),
          config: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('额外配置对象(permissionsPreset, approvalPreset 等)'),
        }),
      },
    ),

    // ---------- 3. 更新 agent ----------
    tool(
      async (input: {
        id: string;
        name?: string;
        description?: string;
        provider_id?: string | null;
        system_prompt?: string;
        mcpServerIds?: string[];
        skillNames?: string[];
        is_default?: boolean;
        config?: Record<string, unknown>;
      }) => {
        if (!input.id) {
          return JSON.stringify({ error: 'id is required' });
        }
        const existing = db
          .prepare('SELECT * FROM agents WHERE id = ? AND project_id = ?')
          .get(input.id, projectId) as AgentRow | undefined;
        if (!existing) {
          return JSON.stringify({ error: `Agent not found: ${input.id}` });
        }

        if (input.name !== undefined && !AGENT_NAME_REGEX.test(input.name.trim())) {
          return JSON.stringify({
            error:
              'Invalid agent name. Must contain only English letters, numbers, spaces, hyphens, or underscores.',
          });
        }
        if (input.provider_id) {
          const provider = db
            .prepare('SELECT id FROM llm_providers WHERE id = ?')
            .get(input.provider_id);
          if (!provider) {
            return JSON.stringify({
              error: `Provider not found: ${input.provider_id}`,
            });
          }
        }

        const now = Date.now();
        const next = {
          name: input.name?.trim() ?? existing.name,
          description:
            input.description !== undefined ? input.description : existing.description,
          provider_id:
            input.provider_id !== undefined ? input.provider_id : existing.provider_id,
          system_prompt:
            input.system_prompt !== undefined ? input.system_prompt : existing.system_prompt,
          config: input.config !== undefined ? JSON.stringify(input.config) : existing.config,
          is_default: input.is_default !== undefined ? (input.is_default ? 1 : 0) : existing.is_default,
        };

        const runTx = db.transaction(() => {
          if (next.is_default === 1) {
            db.prepare(
              'UPDATE agents SET is_default = 0, updated_at = ? WHERE project_id = ? AND id != ?',
            ).run(now, projectId, input.id);
          }
          db.prepare(
            `UPDATE agents SET
              name = ?, description = ?, provider_id = ?, system_prompt = ?, config = ?, is_default = ?, updated_at = ?
              WHERE id = ?`,
          ).run(
            next.name,
            next.description,
            next.provider_id,
            next.system_prompt,
            next.config,
            next.is_default,
            now,
            input.id,
          );

          if (Array.isArray(input.mcpServerIds)) {
            db.prepare('DELETE FROM agent_mcp_servers WHERE agent_id = ?').run(input.id);
            const insertMcp = db.prepare(
              'INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES (?, ?)',
            );
            // mcp_servers is a global table (no project_id column per
            // database.ts:139-148), so we only validate the server exists.
            for (const mcpId of input.mcpServerIds) {
              const exists = db
                .prepare('SELECT id FROM mcp_servers WHERE id = ?')
                .get(mcpId);
              if (exists) insertMcp.run(input.id, mcpId);
            }
          }

          if (Array.isArray(input.skillNames)) {
            db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(input.id);
            const insertSkill = db.prepare(
              'INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, ?)',
            );
            for (const skillId of input.skillNames) {
              const scope = skillId.includes(':') ? skillId.split(':', 1)[0] : 'project';
              if (scope === 'global') insertSkill.run(input.id, skillId);
            }
          }
        });

        try {
          runTx();
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(input.id) as AgentRow;
        return JSON.stringify({
          ...serializeAgent(row),
          mcpServerIds: getMcpIdsForAgent(input.id),
          skillNames: getSkillNamesForAgent(input.id),
        });
      },
      {
        name: 'update_agent',
        description:
          '更新已有 agent。仅更新提供的字段;未提供的字段保持不变。' +
          'mcpServerIds / skillNames 整体替换(若提供)。' +
          '返回更新后的 agent 完整信息。',
        schema: z.object({
          id: z.string().describe('要更新的 agent ID'),
          name: z.string().optional().describe('新名称'),
          description: z.string().optional().describe('新描述'),
          provider_id: z.string().nullable().optional().describe('新 provider ID'),
          system_prompt: z.string().optional().describe('新系统提示词'),
          mcpServerIds: z.array(z.string()).optional().describe('新的 MCP server ID 列表'),
          skillNames: z.array(z.string()).optional().describe('新的 skill 名称列表'),
          is_default: z.boolean().optional().describe('是否设为默认'),
          config: z.record(z.string(), z.unknown()).optional().describe('新 config 对象'),
        }),
      },
    ),

    // ---------- 4. 删除 agent ----------
    tool(
      async ({ id }: { id: string }) => {
        if (!id) {
          return JSON.stringify({ error: 'id is required' });
        }
        const existing = db
          .prepare('SELECT id, name FROM agents WHERE id = ? AND project_id = ?')
          .get(id, projectId) as { id: string; name: string } | undefined;
        if (!existing) {
          return JSON.stringify({ error: `Agent not found: ${id}` });
        }

        const runTx = db.transaction(() => {
          db.prepare('DELETE FROM agent_mcp_servers WHERE agent_id = ?').run(id);
          db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(id);
          // agent_runs.agent_id 显式置 NULL — 否则 FK ON DELETE CASCADE
          // (database.ts:176) 会把该 agent 的所有 run 记录连带 agent_tool_calls
          // (database.ts:190) 一起删,run 历史就丢了。
          db.prepare('UPDATE agent_runs SET agent_id = NULL WHERE agent_id = ?').run(id);
          // 注: sessions.agent_id 引用靠 FK ON DELETE SET NULL(database.ts:87)
          // 自动 orphan,无需手动 UPDATE。messages 表无 agent_id 列,引用经
          // session_id 间接保留 — 不要加 UPDATE messages。
          db.prepare('DELETE FROM agents WHERE id = ?').run(id);
        });
        runTx();

        return JSON.stringify({
          deleted: true,
          id,
          name: existing.name,
          note: 'agent_runs 引用已 detach(agent_id 置 NULL,run / tool-call 历史保留);' +
                'sessions.agent_id 由 FK ON DELETE SET NULL 自动 orphan;messages 经 session_id 间接保留',
        });
      },
      {
        name: 'delete_agent',
        description:
          '删除 agent(清掉 agent_mcp_servers / agent_skills 关联)。' +
          '注意:agent_runs 中对该 agent 的引用被显式 detach(agent_id 置 NULL),' +
          '所以运行历史与 tool-call 历史仍保留可查(只不再归属此 agent)。' +
          'sessions.agent_id 引用由 FK ON DELETE SET NULL 自动 orphan,消息历史经 session_id 间接保留。',
        schema: z.object({
          id: z.string().describe('要删除的 agent ID'),
        }),
      },
    ),
  ];
}
