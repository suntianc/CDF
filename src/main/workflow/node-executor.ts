/**
 * Agent 节点执行器 — 工作流中每个 Agent 节点的执行逻辑
 *
 * 基于 D-08: Agent 节点直接引用资产库，自动继承 LLM/MCP/Skills 配置。
 * D-16a: 独立 workflow runtime，不复用 chat runtime 的 session/checkpoint 逻辑。
 */

import { createDeepAgent } from 'deepagents';
import db from '../database';
import { createLangChainModel } from '../deepagent/llm-adapter';
import { loadMcpTools } from '../deepagent/mcp-connector';
import { resolveAgentSkillsConfig } from '../deepagent/skill-manager';
import type { MCPServer } from '../../shared/types';

// ---- Error Types ----

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

export class AgentTimeoutError extends Error {
  constructor(agentId: string, timeoutMs: number) {
    super(`Agent execution timed out after ${timeoutMs}ms: ${agentId}`);
    this.name = 'AgentTimeoutError';
  }
}

// ---- DB Helpers (mirrored from runtime.ts) ----

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: string | null;
}

interface ProviderRow {
  id: string;
  provider_type: string;
  api_key?: string | null;
  api_url?: string | null;
  default_model: string;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
}

function getAgent(agentId: string): AgentRow {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
  if (!agent) throw new AgentNotFoundError(agentId);
  return agent;
}

function getProvider(providerId: string | null | undefined): ProviderRow {
  const id = providerId?.trim();
  if (!id) throw new Error('Agent has no provider configured');
  const provider = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id) as ProviderRow | undefined;
  if (!provider) throw new Error(`LLM provider not found: ${id}`);
  return provider;
}

interface MCPServerRow {
  id: string;
  name: string;
  server_type: 'stdio' | 'sse' | 'http';
  config: string | null;
  is_connected: number;
  last_health_check?: number;
  created_at: number;
  updated_at: number;
}

function getAgentMcpServers(agentId: string): MCPServer[] {
  const rows = db.prepare(`
    SELECT m.* FROM mcp_servers m
    INNER JOIN agent_mcp_servers ams ON ams.mcp_server_id = m.id
    WHERE ams.agent_id = ?
  `).all(agentId) as MCPServerRow[];

  return rows.map((row) => ({
    ...row,
    config: row.config ? JSON.parse(row.config) : {},
    is_connected: !!row.is_connected,
  }));
}

function getAgentSkillNames(agentId: string): string[] {
  const rows = db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(agentId) as Array<{ skill_name: string }>;
  return rows.map((r) => r.skill_name);
}

// ---- State Extraction (D-16b: 防止上下文窗口溢出) ----

/**
 * 从工作流状态中提取当前节点需要的切片：inputs + 指定上游节点的 nodeOutputs。
 * 只传递相关数据，防止上下文窗口溢出。
 */
export function createNodeStateExtractor(
  nodeId: string,
  upstreamNodeIds: string[],
): (state: Record<string, unknown>) => { inputs: Record<string, unknown>; upstreamOutputs: Record<string, unknown> } {
  return (state) => {
    const inputs = (state.inputs as Record<string, unknown>) ?? {};
    const nodeOutputs = (state.nodeOutputs as Record<string, unknown>) ?? {};
    const upstreamOutputs: Record<string, unknown> = {};

    for (const upstreamId of upstreamNodeIds) {
      if (upstreamId in nodeOutputs) {
        upstreamOutputs[upstreamId] = nodeOutputs[upstreamId];
      }
    }

    return { inputs, upstreamOutputs };
  };
}

// ---- Node Executor Factory ----

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * 创建 Agent 节点执行器
 *
 * 返回一个函数，接受 WorkflowStateType，返回该节点的输出。
 * 内部创建 DeepAgent 实例（继承 Agent 的 LLM/MCP/Skills），执行后返回结果。
 */
export function createAgentNodeExecutor(
  node: { id: string; type: string; data: { agentId?: string; label?: string; retryCount?: number } },
) {
  const agentId = node.data.agentId;
  if (!agentId) {
    throw new Error(`Node ${node.id} has no agentId configured`);
  }

  // 预加载 Agent 定义（在图构建时，而非执行时）
  const agentRow = getAgent(agentId);
  const provider = getProvider(agentRow.provider_id);
  const mcpServers = getAgentMcpServers(agentId);
  const skillNames = getAgentSkillNames(agentId);

  // 找到上游节点 IDs（用于 state 切片提取）
  // 注意：upstreamNodeIds 在 buildWorkflowGraph 中通过 edges 分析传入
  // 这里先用空数组，由 graph-builder 传入
  const extractState = createNodeStateExtractor(node.id, []);

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const startTime = Date.now();

    try {
      // 1. 创建 DeepAgent 实例（每次执行独立创建，不共享 chat runtime）
      const model = createLangChainModel({
        apiKey: provider.api_key ?? undefined,
        apiUrl: provider.api_url ?? undefined,
        defaultModel: provider.default_model,
        providerType: provider.provider_type as any,
      });

      const project = db.prepare('SELECT id, name, path FROM projects WHERE id = ?')
        .get(agentRow.project_id) as ProjectRow | undefined;

      if (!project) {
        throw new Error(`Project not found: ${agentRow.project_id}`);
      }

      // 加载 MCP 工具
      const mcpRuntime = await loadMcpTools(agentId, mcpServers);

      // 加载 Skills 配置
      const { skillsSources } = resolveAgentSkillsConfig(project.path, skillNames);

      // 2. 创建 DeepAgent（无 checkpointer — D-16a 独立 runtime）
      const agent = createDeepAgent({
        model,
        systemPrompt: agentRow.system_prompt || undefined,
        tools: [...mcpRuntime.tools],
        skills: skillsSources.length > 0 ? skillsSources : undefined,
      });

      // 3. 构造 user message：只传递 inputs + 相关上游 nodeOutputs
      const { inputs, upstreamOutputs } = extractState(state);

      const taskContext = [
        `## 工作流节点任务`,
        `节点名称: ${node.data.label || node.id}`,
        agentRow.description ? `节点描述: ${agentRow.description}` : '',
        '',
        `## 输入参数`,
        JSON.stringify(inputs, null, 2),
        '',
        Object.keys(upstreamOutputs).length > 0
          ? `## 上游节点输出\n${JSON.stringify(upstreamOutputs, null, 2)}`
          : '',
      ].filter(Boolean).join('\n');

      // 4. 执行 DeepAgent（单次调用，非流式）
      const result = await Promise.race([
        agent.invoke({
          messages: [{ role: 'user', content: taskContext }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AgentTimeoutError(agentId, DEFAULT_TIMEOUT_MS)), DEFAULT_TIMEOUT_MS)
        ),
      ]);

      // 5. 收集结果
      const duration = Date.now() - startTime;
      const lastMessage = result?.messages?.[result.messages.length - 1];
      const output = lastMessage?.content ?? '';

      return {
        result: typeof output === 'string' ? output : JSON.stringify(output),
        nodeId: node.id,
        agentId,
        duration_ms: duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;

      if (err instanceof AgentTimeoutError || err instanceof AgentNotFoundError) {
        throw err;
      }

      // 包装未知错误
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Agent node ${node.id} execution failed: ${message}`);
    }
  };
}
