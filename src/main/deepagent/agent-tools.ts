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
 *
 * @param projectId - 当前项目 ID
 * @param activeAgentId - 当前 chat session 正在用的 agent ID(用于在
 *   delete_agent 时拒绝删除正在跑的 agent,避免 CASCADE 删掉 in-flight
 *   agent_runs 行,导致后续 agent_tool_calls FK 错误 / updateRun 0 行)
 */
export function createAgentTools(
  projectId: string,
  options: { activeAgentId?: string | null } = {},
) {
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
        // 工具兜底:省略时回退到 active provider(与 runtime.ts:78-89
        // getFallbackProviderId 同款逻辑);没有 provider 则拒绝。
        // 注:不能简单 ORDER BY id 取字典序第一个,可能是未激活的旧 provider。
        let effectiveProviderId = input.provider_id ?? null;
        if (!effectiveProviderId) {
          const activeProvider = db
            .prepare(
              'SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1',
            )
            .get() as { id: string } | undefined;
          const anyProvider =
            activeProvider ??
            (db
              .prepare('SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1')
              .get() as { id: string } | undefined);
          if (!anyProvider) {
            return JSON.stringify({
              error:
                'No LLM provider configured. The user must add one in Settings before creating agents, or pass provider_id explicitly.',
            });
          }
          effectiveProviderId = anyProvider.id;
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

        // 自审 P2 候选 #1:create_agent 不传 is_default 时若项目当前无 default,
        // 默默留下 "项目无 default agent" 的污染路径 — 下次 chat omit agentId
        // 会触发 ensureDefaultAgent (runtime.ts:119) 默默插 "Master Agent" 行。
        // 同 P2 #11/#12 的 invariant 漏洞,只是发生在 create_agent 路径。
        // 修法:在 create_agent 后查项目 default,若无则把刚建的 agent 顶上去。
        // 显式传 is_default: false 的不在此列 — 用户明确说"不设默认",尊重。
        if (!input.is_default) {
          const anyDefault = db
            .prepare('SELECT 1 AS one FROM agents WHERE project_id = ? AND is_default = 1 LIMIT 1')
            .get(projectId) as { one: number } | undefined;
          if (!anyDefault) {
            db.prepare('UPDATE agents SET is_default = 1, updated_at = ? WHERE id = ?').run(
              Date.now(),
              id,
            );
          }
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

        // Codex P2 #11: 拒绝把项目唯一 default agent 改为非 default。
        // 否则下次 chat omit agentId 时,ensureDefaultAgent (runtime.ts:119) 找不到
        // 任何 default,会调 createDefaultAgent 插入一个新 "Master Agent",
        // 默默改了 default 还污染 agent 库。UI 的 db:saveAgent 路径(ipc-handlers.ts:432)
        // 也只 reset 其他 default(当设为 true 时),不防最后 default 被 unset。
        if (next.is_default === 0 && existing.is_default === 1) {
          const otherDefaults = db
            .prepare('SELECT id FROM agents WHERE project_id = ? AND is_default = 1 AND id != ?')
            .get(projectId, input.id) as { id: string } | undefined;
          if (!otherDefaults) {
            return JSON.stringify({
              error:
                `Cannot unset the project's only default agent (id=${input.id}). ` +
                `The project would have no default agent, and the next chat that omits an ` +
                `explicit agent id would auto-create a new "Master Agent" row, silently ` +
                `changing the default and cluttering the library. Either pass is_default: true ` +
                `to keep this agent as default, or first create / promote another agent as default ` +
                `(use list_agents + update_agent on the other with is_default: true).`,
            });
          }
        }

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
        // Codex P1 #7: 拒绝删除当前 chat session 正在跑的 agent。
        // 否则 FK CASCADE 会删掉 in-flight agent_runs 行,后续 agent_tool_calls
        // insert 引用已不存在的 run_id(报 FK 错) / updateRun 静默 0 行,
        // 整个当前对话的 run 记录全丢。模型应当选别的 agent 切换后再删。
        if (options.activeAgentId && id === options.activeAgentId) {
          return JSON.stringify({
            error:
              `Cannot delete the agent currently running this chat session (id=${id}). ` +
              `Switch to a different agent first, then retry the deletion. ` +
              `Deleting it now would cascade-delete the in-flight agent_runs row, ` +
              `leaving subsequent tool-call log inserts to fail with FK errors.`,
          });
        }
        const existing = db
          .prepare('SELECT id, name, is_default FROM agents WHERE id = ? AND project_id = ?')
          .get(id, projectId) as { id: string; name: string; is_default: number } | undefined;
        if (!existing) {
          return JSON.stringify({ error: `Agent not found: ${id}` });
        }

        // Codex P2 #9 + P2 #10: 防御深度 — 即使本 runtime 的 activeAgentId 跟目标 id 不匹配,
        // 其他 session / runtime 可能正在用这个 agent 跑 in-flight run。
        // runLLMChat 路径 (src/main/llm.ts:createRun) 在 streaming 期间会 insert 一行
        // status='running' 的 agent_runs,工具调用需要用户 approve 时
        // (llm.ts:764 updateRun(runId, 'waiting_approval')) 也会改 status。
        // 后续 tool-call 写 log / updateRun 都引用这行的 run_id。FK ON DELETE CASCADE
        // 会把该行也删,那个 chat 的 run/tool-call 记录就崩了。
        //
        // in-flight 状态集对应 src/shared/types.ts:298 AgentRunStatus 联合类型:
        //   'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted'
        // in-flight = 头 2 个(还没结束的),terminal = 后 3 个。
        // 若以后加新的 in-flight 状态(例如 'paused'),需同步更新此列表。
        const inFlightRun = db
          .prepare(
            "SELECT id, session_id, status FROM agent_runs " +
              "WHERE agent_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1",
          )
          .get(id) as { id: string; session_id: string; status: string } | undefined;
        if (inFlightRun) {
          return JSON.stringify({
            error:
              `Cannot delete agent: another chat session has an in-flight run with this agent ` +
              `(agent_runs id=${inFlightRun.id} status='${inFlightRun.status}' session_id=${inFlightRun.session_id}). ` +
              `Wait for the run to finish (status transitions to 'completed' / 'failed' / 'aborted'), ` +
              `then retry the deletion. Deleting now would cascade-delete the in-flight agent_runs row, ` +
              `breaking its tool-call log writes and final updateRun.`,
          });
        }

        // Codex P2 #12: 同 P2 #11 的 invariant 护栏 — 项目必须至少有 1 个 default agent。
        // delete_agent 的 active-agent guard 只保护 running 的 agent,in-flight query
        // 只保护 active runs,但项目 invariant("至少 1 个 default")是被另外两个
        // 护栏间接覆盖不到的不变量。删唯一 default 同样会触发 ensureDefaultAgent
        // 自动插 Master Agent 的污染路径。
        //
        // 注:本会话 P2 #11 给 update_agent 加了同款护栏但漏了 delete_agent —
        // codex 用 P2 #12 揭示这个疏漏。教训见 codex-review-checklist §20 强化:
        // 加 invariant 护栏时,**审计所有 destructive 操作**,不只是当前在写的那个。
        if (existing.is_default === 1) {
          const otherDefaults = db
            .prepare('SELECT id FROM agents WHERE project_id = ? AND is_default = 1 AND id != ?')
            .get(projectId, id) as { id: string } | undefined;
          if (!otherDefaults) {
            return JSON.stringify({
              error:
                `Cannot delete the project's only default agent (id=${id}). ` +
                `The project would have no default agent, and the next chat that omits an ` +
                `explicit agent id would auto-create a new "Master Agent" row, silently ` +
                `changing the default and cluttering the library. First use update_agent to ` +
                `promote another agent as default (set its is_default: true), then retry.`,
            });
          }
        }

        // 与现有 db:deleteAgent IPC (ipc-handlers.ts:486-488) 行为一致:
        // 单条 DELETE FROM agents,FK CASCADE 负责清理 mcp/skill/run/tool-call 关联。
        // sessions.agent_id 由 FK ON DELETE SET NULL (database.ts:87) 自动 orphan。
        // messages 表无 agent_id 列,引用经 session_id 间接保留。
        //
        // 注:曾尝试 UPDATE agent_runs SET agent_id = NULL 以保留 run 历史,
        // 但 database.ts:168 声明 agent_runs.agent_id TEXT NOT NULL,SQLite 拒收
        // NULL 赋值,所以保留 run 历史需要 schema 变更(migration 把列改为 NULL),
        // 已超出本 PR 范围。
        const runTx = db.transaction(() => {
          db.prepare('DELETE FROM agents WHERE id = ?').run(id);
        });
        runTx();

        return JSON.stringify({
          deleted: true,
          id,
          name: existing.name,
          note: 'agent_mcp_servers / agent_skills / agent_runs / agent_tool_calls 已通过 FK CASCADE 清理;' +
                'sessions.agent_id 由 SET NULL FK 自动 orphan;messages 经 session_id 间接保留',
        });
      },
      {
        name: 'delete_agent',
        description:
          '删除 agent。**该操作会通过 FK CASCADE 一并清掉该 agent 的** agent_mcp_servers / agent_skills /' +
          ' agent_runs / agent_tool_calls 记录(因为 agent_runs.agent_id 是 NOT NULL,无法 detach)。' +
          'sessions.agent_id 由 SET NULL FK 自动 orphan,会话与消息历史仍可查(经 session_id)。' +
          '等同于 UI 中"删除"按钮的 db:deleteAgent IPC 行为 (ipc-handlers.ts:486-488)。' +
          '**禁止删除当前 chat 正在用的 agent**(会破坏 in-flight run):请先 list_agents 看当前用的是哪个,然后先切换到别的 agent 再删。',
        schema: z.object({
          id: z.string().describe('要删除的 agent ID'),
        }),
      },
    ),
  ];
}
