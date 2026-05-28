/**
 * Agent 节点执行器 — 工作流中每个 Agent 节点的执行逻辑
 *
 * 基于 D-08: Agent 节点直接引用资产库，自动继承 LLM/MCP/Skills 配置。
 * D-16a: 独立 workflow runtime，不复用 chat runtime 的 session/checkpoint 逻辑。
 */

import { createDeepAgent } from 'deepagents';
import db from '../database';
import { decryptApiKey } from '../security';
import { createLangChainModel } from '../deepagent/llm-adapter';
import { loadMcpTools } from '../deepagent/mcp-connector';
import { resolveAgentSkillsConfig } from '../deepagent/skill-manager';
import type { MCPServer, WorkflowNode } from '../../shared/types';

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
  return {
    ...provider,
    api_key: provider.api_key ? decryptApiKey(provider.api_key) : undefined,
  };
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
const MAX_LOOP_NODE_ITERATIONS = 50;

function extractJsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function extractWorkflowRouting(output: string): Record<string, string> | undefined {
  const parsed = extractJsonCandidate(output);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const routing = (parsed as { routing?: unknown }).routing;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return undefined;

  const normalized = Object.entries(routing as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {} as Record<string, string>);

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function clampLoopCount(loopCount: number | undefined): number {
  if (!Number.isFinite(loopCount)) return 1;
  return Math.max(1, Math.min(MAX_LOOP_NODE_ITERATIONS, Math.floor(loopCount ?? 1)));
}

function isLoopCompleteSignal(routing: Record<string, string> | undefined, nodeId: string): boolean {
  const signal = routing?.[nodeId] ?? routing?.[`${nodeId}_status`] ?? routing?.status;
  if (!signal) return false;
  return ['done', 'complete', 'completed', 'stop', 'finished', '完成', '已完成', '结束'].includes(signal.trim().toLowerCase());
}

function getLastMessageText(result: any): string {
  const lastMessage = result?.messages?.[result.messages.length - 1];
  const output = lastMessage?.content ?? '';
  return typeof output === 'string' ? output : JSON.stringify(output);
}

/**
 * 创建 Agent 节点执行器
 *
 * 返回一个函数，接受 WorkflowStateType，返回该节点的输出。
 * 内部创建 DeepAgent 实例（继承 Agent 的 LLM/MCP/Skills），执行后返回结果。
 */
export function createAgentNodeExecutor(
  node: WorkflowNode,
  upstreamNodeIds: string[] = [],
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
  // upstreamNodeIds 由 buildWorkflowGraph 通过 edges 分析传入
  const extractState = createNodeStateExtractor(node.id, upstreamNodeIds);

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

      const nodeKind = node.data.nodeKind ?? (node.type === 'agent' ? 'task' : node.type);
      const taskDescription = node.data.taskDescription || node.data.description || '';
      const nodeSpecificContext = [
        nodeKind === 'task' ? `## 普通任务节点\n任务描述: ${taskDescription || '未填写'}` : '',
        nodeKind === 'loop'
          ? [
              `## Loop 节点`,
              `任务描述: ${taskDescription || '未填写'}`,
              `循环次数: ${node.data.loopCount ?? 1}`,
              `该节点会按循环次数多次调用 Agent。每一轮都会收到上一轮输出，请只完成当前轮次应做的工作。`,
            ].join('\n')
          : '',
        nodeKind === 'review'
          ? [
              `## 审查节点`,
              `规范: ${node.data.reviewSpec || taskDescription || '未填写'}`,
              node.data.reviewRules ? `条件规则:\n${node.data.reviewRules}` : '',
              `请根据上游输出和规范给出审查描述，并在最终回复中包含 JSON 路由片段。`,
              `默认路由条件键使用当前节点 ID: ${node.id}`,
              `示例: {"routing":{"${node.id}":"通过"}}`,
            ].filter(Boolean).join('\n')
          : '',
      ].filter(Boolean).join('\n\n');

      const taskContext = [
        `## 工作流节点任务`,
        `节点名称: ${node.data.label || node.id}`,
        `节点类型: ${nodeKind}`,
        agentRow.description ? `节点描述: ${agentRow.description}` : '',
        nodeSpecificContext,
        '',
        `如果该节点需要决定条件分支，请在最终回复中包含 JSON 片段：`,
        `{"routing":{"路由条件键":"匹配值"}}`,
        '',
        `## 输入参数`,
        JSON.stringify(inputs, null, 2),
        '',
        Object.keys(upstreamOutputs).length > 0
          ? `## 上游节点输出\n${JSON.stringify(upstreamOutputs, null, 2)}`
          : '',
      ].filter(Boolean).join('\n');

      const invokeAgent = async (content: string): Promise<string> => {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new AgentTimeoutError(agentId, DEFAULT_TIMEOUT_MS)),
            DEFAULT_TIMEOUT_MS,
          );
        });

        try {
          const result = await Promise.race([
            agent.invoke({
              messages: [{ role: 'user', content }],
            }),
            timeoutPromise,
          ]);
          return getLastMessageText(result);
        } finally {
          clearTimeout(timeoutId!);
        }
      };

      if (nodeKind === 'loop') {
        const loopCount = clampLoopCount(node.data.loopCount);
        const iterations: Array<{ iteration: number; result: string; routing?: Record<string, string>; duration_ms: number }> = [];
        let previousIterationOutput: string | undefined;
        let finalRouting: Record<string, string> | undefined;

        for (let iteration = 1; iteration <= loopCount; iteration += 1) {
          const iterationStart = Date.now();
          const iterationContext = [
            taskContext,
            '',
            `## Loop 执行轮次`,
            `当前轮次: ${iteration}/${loopCount}`,
            previousIterationOutput
              ? `## 上一轮输出\n${previousIterationOutput}`
              : `这是第 1 轮，请基于输入参数和上游节点输出开始执行。`,
            '',
            `如果已经满足任务目标，可以在最终回复中包含 JSON：{"routing":{"${node.id}":"done"}} 来提前结束 Loop。`,
          ].filter(Boolean).join('\n');

          const resultText = await invokeAgent(iterationContext);
          const routing = extractWorkflowRouting(resultText);
          finalRouting = routing ?? finalRouting;
          iterations.push({
            iteration,
            result: resultText,
            ...(routing ? { routing } : {}),
            duration_ms: Date.now() - iterationStart,
          });
          previousIterationOutput = resultText;

          if (isLoopCompleteSignal(routing, node.id)) {
            break;
          }
        }

        const duration = Date.now() - startTime;
        const finalResult = iterations[iterations.length - 1]?.result ?? '';

        return {
          result: finalResult,
          iterations,
          iteration_count: iterations.length,
          max_iterations: loopCount,
          nodeId: node.id,
          agentId,
          duration_ms: duration,
          ...(finalRouting ? { routing: finalRouting } : {}),
        };
      }

      // 4. 执行 DeepAgent（普通任务 / 审查节点为单次调用）
      const resultText = await invokeAgent(taskContext);

      // 5. 收集结果
      const duration = Date.now() - startTime;
      const routing = extractWorkflowRouting(resultText);

      return {
        result: resultText,
        nodeId: node.id,
        agentId,
        duration_ms: duration,
        ...(routing ? { routing } : {}),
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
