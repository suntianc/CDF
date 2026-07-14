import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { isGraphInterrupt, MemorySaver } from '@langchain/langgraph';
import { createMiddleware, modelRetryMiddleware, ToolMessage, toolRetryMiddleware } from 'langchain';
import db from '../database';
import log from '../logger';
import store from '../store';
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend } from 'deepagents';
import { createLangChainModel } from './llm-adapter';
import {
  assembleDeepAgentRuntime,
  resolveRuntimeProviderModelConfig,
  registerCdfHarnessProfile,
  extractPathMentionContext,
} from './runtime-assembly';
import {
  getProvider,
  getAgentMcpServers,
  getConnectedMcpServers,
  getAgentSkillNames,
  normalizeProviderId,
  resolveInterruptOn,
  createSpanId,
  createBuiltInTools,
  loadRegistryTools,
  loadMcpTools,
  getRuntimeToolNames,
  type ProviderRow,
} from './shared-infra';
import { createAgentTools } from './agent-tools';
import { createParallelTaskTool } from './parallel-task-tool';
import { getRunBySessionId, getWorkflowRun, createAdvanceStageTool, createStageRouteBlockerTool, createTaskGraphTools } from '../workflow-run';
import { isTransientRuntimeError } from './runtime-errors';
import { DelegatedAgentRunRepository } from './delegated-agent-run-repository';
import {
  DelegatedAgentRunCoordinator,
  type DelegatedRuntimeAdapter,
  type DelegatedRuntimeRequest,
} from './delegated-agent-run-coordinator';
import type { DelegatedAgentRun, DelegatedTaskResult } from '../../shared/types';
import { createDelegatedSubagentAdapter } from './delegated-subagent-adapter';
import { readAgentToolScope, selectDelegatedToolScope } from './agent-tool-scope';
import { resolveDelegatedModelOverrides } from './delegated-model-selection';
import { conversationWorkingStateLifecycle } from './conversation-working-state';
export { isTransientRuntimeError } from './runtime-errors';

// 工作流运行纪律：仅在 Workflow Run 主 Agent 的系统提示词末尾追加，指导其用
// advance_stage 推进阶段、先规划任务图再派单——避免把多阶段工作流当成一次性任务收尾。
const WORKFLOW_RUN_PROMPT = `

[工作流运行纪律]
你正在以主 Agent 身份执行一个多阶段工作流（Workflow Run）。请严格遵守：
当信息不足以选择当前 Stage 的已编排路线时，调用 report_stage_route_blocker，向用户说明缺失信息并停止本轮；不要展示内部路线控制，不要猜测默认路线。
- 每完成一个阶段并对照验收标准自检通过后，必须调用 advance_stage 工具提交结构化验收报告（逐条自评 + 产物清单 + 总结）；这会触发阶段门禁并推进到下一阶段。不要只用文字宣布"完成"就停下——不调用 advance_stage 工作流不会前进。
- 阶段内先用 create_task 一次性规划任务图并用 set_task_dependencies 标注依赖，再用 parallel_tasks 派子 Agent 执行，用 update_task_status / list_tasks 跟踪进度。
- 阶段游标由主进程在门禁通过后权威推进，你无需自行编号或跳跃阶段。`;
import { DELEGATED_TASK_RESULT_SCHEMA, type ApprovalMode, type ChatRuntimeOverrides, type ExecutionStep } from '../../shared/types';
import { getCurrentStreamAccumulator } from './stream-accumulator';
// Re-export for DelegatedTaskResultSchema consumers (types.ts)
export { DELEGATED_TASK_RESULT_SCHEMA };

interface SubagentStepContext {
  onStep: (step: ExecutionStep) => void;
}

export const subagentStepStorage = new AsyncLocalStorage<SubagentStepContext>();

interface RuntimeAgentRow {
  id: string;
  project_id: string;
  name: string;
  slug?: string | null;  // D-03: task(name) stable key
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

interface RuntimeProjectRow {
  id: string;
  name: string;
  path: string;
}

// Phase 7 Plan 01: alias to shared ChatRuntimeOverrides (Gap 2 fix).
type RuntimeModelOverrides = ChatRuntimeOverrides;

interface RuntimeInputMessage {
  id: string;
  content: string;
  imageBase64?: string[];
}


export const DEEPAGENT_CHECKPOINT_NAMESPACE = '';

function getFallbackProviderId(): string {
  const provider = db
    .prepare('SELECT * FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined;
  const fallbackProvider = provider || (db.prepare('SELECT * FROM llm_providers ORDER BY updated_at DESC LIMIT 1').get() as { id: string } | undefined);

  if (!fallbackProvider) {
    throw new Error('请先在模型设置中配置并激活一个 LLM 提供商。');
  }

  return fallbackProvider.id;
}

function getProject(projectId: string): RuntimeProjectRow {
  const project = db.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(projectId) as RuntimeProjectRow | undefined;
  if (!project) {
    throw new Error(`Project with ID ${projectId} not found.`);
  }
  return project;
}

function normalizeDefaultAgents(projectId: string): RuntimeAgentRow | null {
  const defaults = db
    .prepare('SELECT * FROM agents WHERE project_id = ? AND is_default = 1 ORDER BY updated_at DESC')
    .all(projectId) as RuntimeAgentRow[];

  if (defaults.length <= 1) return defaults[0] || null;

  const [winner, ...duplicates] = defaults;
  const unset = db.prepare('UPDATE agents SET is_default = 0, updated_at = ? WHERE id = ?');
  const now = Date.now();
  for (const duplicate of duplicates) {
    unset.run(now, duplicate.id);
  }
  return winner;
}

function providerExists(providerId: string): boolean {
  return !!db.prepare('SELECT id FROM llm_providers WHERE id = ?').get(providerId);
}

function ensureDefaultAgent(projectId: string): RuntimeAgentRow {
  const normalized = normalizeDefaultAgents(projectId);
  if (normalized) {
    const normalizedProviderId = normalizeProviderId(normalized.provider_id);
    // 验证 provider 仍然存在，否则 fallback
    if (normalizedProviderId && providerExists(normalizedProviderId)) {
      return {
        ...normalized,
        provider_id: normalizedProviderId,
      };
    }

    const fallbackProviderId = getFallbackProviderId();
    const now = Date.now();
    db.prepare('UPDATE agents SET provider_id = ?, updated_at = ? WHERE id = ?').run(fallbackProviderId, now, normalized.id);
    return {
      ...normalized,
      provider_id: fallbackProviderId,
      updated_at: now,
    };
  }

  const fallbackProviderId = getFallbackProviderId();

  const now = Date.now();
  const agent: RuntimeAgentRow = {
    id: crypto.randomUUID(),
    project_id: projectId,
    name: 'Master Agent',
    description: '项目默认 Agent',
    provider_id: fallbackProviderId,
    system_prompt: '你是该项目的默认 Master Agent，负责综合使用 Skills、MCP 工具和项目上下文帮助用户完成开发任务。',
    config: null,
    is_default: 1,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO agents (id, project_id, name, description, provider_id, system_prompt, config, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.id,
    agent.project_id,
    agent.name,
    agent.description,
    agent.provider_id,
    agent.system_prompt,
    agent.config,
    agent.is_default,
    agent.created_at,
    agent.updated_at
  );

  return agent;
}

function getRuntimeAgent(projectId: string, agentId?: string | null): RuntimeAgentRow {
  if (agentId) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND project_id = ?').get(agentId, projectId) as RuntimeAgentRow | undefined;
    if (agent) {
      const normalizedProviderId = normalizeProviderId(agent.provider_id);
      if (normalizedProviderId && providerExists(normalizedProviderId)) {
        return { ...agent, provider_id: normalizedProviderId };
      }
      return { ...agent, provider_id: getFallbackProviderId() };
    }
  }
  return ensureDefaultAgent(projectId);
}


function getSessionMessages(sessionId: string) {
  return db.prepare("SELECT id, role, content FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') ORDER BY created_at ASC").all(sessionId) as Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
}

async function hasCheckpoint(sessionId: string, checkpointer: SqliteSaver): Promise<boolean> {
  const checkpoint = await checkpointer.getTuple({
    configurable: {
      thread_id: sessionId,
      checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
    },
  });
  return !!checkpoint;
}

async function buildInputMessages(sessionId: string, currentMessage: RuntimeInputMessage, checkpointer: SqliteSaver) {
  const currentContent: string | Array<{ type: string; [key: string]: unknown }> =
    currentMessage.imageBase64?.length
      ? [
          ...currentMessage.imageBase64.map((dataUrl) => ({
            type: 'image_url',
            image_url: { url: dataUrl },
          })),
          { type: 'text', text: currentMessage.content },
        ]
      : currentMessage.content;

  if (await hasCheckpoint(sessionId, checkpointer)) {
    return [{ role: 'user' as const, content: currentContent }];
  }

  const history = getSessionMessages(sessionId);
  const hasCurrent = history.some((message) => message.id === currentMessage.id);
  return [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(hasCurrent ? [] : [{ role: 'user' as const, content: currentContent }]),
  ];
}


function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function getRecoverableToolErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'TIMEOUT';
  // undici/fetch stream cut (TypeError: terminated)
  if (lower === 'terminated' || lower.includes('network') || lower.includes('fetch failed')) return 'NETWORK';
  if (lower.includes('rate limit') || lower.includes('429')) return 'RATE_LIMIT';
  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('forbidden')) return 'PERMISSION_DENIED';
  if (lower.includes('not found') || lower.includes('enoent')) return 'NOT_FOUND';
  return 'TOOL_FAILED';
}

function getRecoverableToolErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function normalizeToolAllowlistEntry(value: string): string {
  const toolName = value.trim().split('(')[0]?.trim() ?? '';
  const alias = toolName.toLowerCase();
  switch (alias) {
    case 'bash':
      return 'bash';
    case 'read':
      return 'read_file';
    case 'write':
      return 'write_file';
    case 'edit':
      return 'edit_file';
    case 'glob':
      return 'glob';
    case 'grep':
      return 'grep';
    case 'ls':
    case 'list':
      return 'ls';
    case 'webfetch':
    case 'fetch':
      return 'fetch';
    default:
      return alias.replace(/[\s-]+/g, '_');
  }
}

function createAllowedToolMatcher(allowedTools?: string[]): ((toolName: string) => boolean) | null {
  const allowed = new Set(
    (allowedTools ?? [])
      .map(normalizeToolAllowlistEntry)
      .filter(Boolean)
  );
  if (allowed.size === 0) return null;
  if (allowed.has('*')) return () => true;
  return (toolName: string) => allowed.has(normalizeToolAllowlistEntry(toolName));
}

function createAllowedToolsMiddleware(allowedTools?: string[]) {
  const isAllowed = createAllowedToolMatcher(allowedTools);
  if (!isAllowed) return null;
  const allowedList = allowedTools?.join(', ') || '(none)';
  return createMiddleware({
    name: 'AllowedToolsMiddleware',
    wrapToolCall: async (request, handler) => {
      const runtimeTool = request as { tool?: { name?: string } };
      const toolName = request.toolCall?.name || runtimeTool.tool?.name || 'unknown';
      if (isAllowed(toolName)) return handler(request);

      return new ToolMessage({
        content: `Tool blocked by allowed-tools (${toolName}). This run allows only: ${allowedList}`,
        tool_call_id: request.toolCall?.id || crypto.randomUUID(),
        name: toolName,
      });
    },
  });
}

function getAllowedToolsMiddlewares(allowedTools?: string[]) {
  const middleware = createAllowedToolsMiddleware(allowedTools);
  return middleware ? [middleware] : [];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
}

function isApprovalInterruptPayloadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return message.includes('actionrequests') && message.includes('reviewconfigs');
}

function createRecoverableToolErrorMiddleware() {
  return createMiddleware({
    name: 'RecoverableToolErrorMiddleware',
    wrapToolCall: async (request, handler) => {
      try {
        const result: any = await handler(request);
        const toolCallId = request.toolCall?.id;
        if (toolCallId) {
          try {
            const row = db.prepare('SELECT approval_status FROM agent_tool_calls WHERE id = ?').get(toolCallId) as { approval_status?: string } | undefined;
            const approvalStatus = row?.approval_status;
            if (approvalStatus === 'approved' || approvalStatus === 'edited') {
              const appendApprovalNote = (msg: any) => {
                if (msg && typeof msg === 'object') {
                  const note = approvalStatus === 'edited'
                    ? '\n\n(此操作由用户修改并审批通过后执行)'
                    : '\n\n(此操作已由用户手动审批通过)';
                  if (typeof msg.content === 'string') {
                    msg.content += note;
                  } else if (Array.isArray(msg.content)) {
                    msg.content.push({ type: 'text', text: note });
                  }
                }
              };

              if (result && typeof result === 'object') {
                if ('lg_name' in result && result.lg_name === 'Command' && result.update?.messages) {
                  for (const msg of result.update.messages) {
                    appendApprovalNote(msg);
                  }
                } else {
                  appendApprovalNote(result);
                }
              }
            }
          } catch (dbErr) {
            console.warn('[RUNTIME] Failed to append approval status to tool result:', dbErr);
          }
        }
        return result;
      } catch (error) {
        if (isAbortError(error) || isGraphInterrupt(error) || isApprovalInterruptPayloadError(error) || request.runtime?.signal?.aborted) {
          throw error;
        }

        const toolName = request.toolCall.name;
        const message = getRecoverableToolErrorMessage(error);
        const code = getRecoverableToolErrorCode(error);
        const content = toolName === 'task'
          ? JSON.stringify({
              status: 'failure',
              artifacts: [],
              summary: '子代理执行失败，主 Agent 需要根据错误继续决策。',
              error: { code, message },
            })
          : `Tool error (${toolName}): ${message}\n\nThe tool call failed. Treat this as an observation and decide the next step.`;

        return new ToolMessage({
          content,
          tool_call_id: request.toolCall.id || crypto.randomUUID(),
          name: toolName,
        });
      }
    },
  });
}

function formatRecoverableToolErrorObservation(error: Error): string {
  const code = getRecoverableToolErrorCode(error);
  const message = getRecoverableToolErrorMessage(error);
  return [
    `Tool error (${code}): ${message}`,
    '',
    'The tool call failed but the subagent run is still active. Treat this as an observation, update your todo list or plan, and decide whether to retry with adjusted input, skip this step, or summarize the blocker.',
  ].join('\n');
}

function formatRecoverableModelErrorObservation(error: Error): string {
  const code = getRecoverableToolErrorCode(error);
  const message = getRecoverableToolErrorMessage(error);
  return [
    `Model call error (${code}): ${message}`,
    '',
    'The model call failed after retry handling. Preserve the current task context and return a structured failure summary instead of crashing the parent run.',
  ].join('\n');
}

function extractStepOutput(output: unknown): unknown {
  if (output == null) return output;
  const obj = output as any;
  if (obj?.kwargs?.content !== undefined) return obj.kwargs.content;
  if (typeof obj?.content !== 'undefined') return obj.content;
  return output;
}

function createSubagentStepMiddleware() {
  return createMiddleware({
    name: 'SubagentStepMiddleware',
    wrapToolCall: async (request, handler) => {
      const ctx = subagentStepStorage.getStore();
      const onStep = ctx?.onStep ?? getCurrentStreamAccumulator()?.onSubagentStep;
      if (!onStep) return handler(request);

      const toolName: string = request.toolCall?.name || 'unknown';
      const startedAt = Date.now();
      const spanId = createSpanId();
      onStep({ type: 'tool_call', tool: toolName, args: (request.toolCall as any)?.args ?? (request.toolCall as any)?.input, ts: startedAt, spanId });

      try {
        const result = await handler(request);
        onStep({
          type: 'tool_result',
          tool: toolName,
          success: true,
          output: extractStepOutput(result),
          ts: Date.now(),
          duration_ms: Date.now() - startedAt,
          spanId,
        });
        return result;
      } catch (error) {
        if (!isAbortError(error) && !isGraphInterrupt(error)) {
          const errMsg = error instanceof Error ? error.message : String(error);
          onStep({ type: 'tool_result', tool: toolName, success: false, error: errMsg, ts: Date.now(), duration_ms: Date.now() - startedAt, spanId });
        }
        throw error;
      }
    },
  });
}

export function createSubagentResilienceMiddleware(...allowedToolSets: Array<string[] | undefined>) {
  return [
    ...allowedToolSets.flatMap((allowedTools) => getAllowedToolsMiddlewares(allowedTools)),
    createSubagentStepMiddleware(),
    createRecoverableToolErrorMiddleware(),
    toolRetryMiddleware({
      maxRetries: 2,
      retryOn: isTransientRuntimeError,
      onFailure: formatRecoverableToolErrorObservation,
    }),
    modelRetryMiddleware({
      maxRetries: 2,
      retryOn: isTransientRuntimeError,
      onFailure: formatRecoverableModelErrorObservation,
    }),
  ];
}

function createDelegatedToolApprovalMiddleware(
  coordinator: DelegatedAgentRunCoordinator,
  delegatedRunId: string,
  gatedToolNames: Set<string>,
) {
  return createMiddleware({
    name: 'DelegatedToolApprovalMiddleware',
    wrapToolCall: async (request, handler) => {
      const runtimeTool = request as { tool?: { name?: string } };
      const toolName = request.toolCall?.name || runtimeTool.tool?.name || 'unknown';
      const actionId = request.toolCall?.id || crypto.randomUUID();
      return coordinator.runToolAction({
        delegatedRunId,
        action: {
          id: actionId,
          name: toolName,
          args: (request.toolCall as { args?: unknown })?.args,
        },
        requiresApproval: gatedToolNames.has(toolName),
        execute: async () => handler(request),
      });
    },
  });
}


function createDelegatedProgressCallbacks(request: DelegatedRuntimeRequest) {
  const onStep = request.onStep;
  if (!onStep) return undefined;

  let tokenBuffer: string[] = [];
  const emitText = (text: string) => {
    if (!text) return;
    onStep({
      type: 'text_chunk',
      ts: Date.now(),
      content: text,
      delegatedRunId: request.delegatedRunId,
    });
  };

  return [{
    handleLLMStart() {
      tokenBuffer = [];
    },
    handleLLMNewToken(token: string) {
      if (token) tokenBuffer.push(token);
    },
    handleLLMEnd(output: unknown) {
      const value = output as {
        generations?: Array<Array<{
          text?: unknown;
          message?: {
            content?: unknown;
            tool_calls?: unknown;
            additional_kwargs?: { tool_calls?: unknown };
          };
        }>>;
      };
      const generation = value.generations?.[0]?.[0];
      const toolCalls = generation?.message?.additional_kwargs?.tool_calls
        ?? generation?.message?.tool_calls;
      const content = generation?.message?.content;
      const hasToolCalls = (Array.isArray(toolCalls) && toolCalls.length > 0)
        || (Array.isArray(content) && content.some((part) => (
          !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool_use'
        )));
      if (hasToolCalls) {
        tokenBuffer = [];
        return;
      }
      if (tokenBuffer.length > 0) {
        for (const token of tokenBuffer) emitText(token);
        tokenBuffer = [];
        return;
      }
      if (typeof content === 'string') {
        emitText(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
            const text = (part as { text?: unknown }).text;
            if (typeof text === 'string') emitText(text);
          }
        }
      } else if (typeof generation?.text === 'string') {
        emitText(generation.text);
      }
    },
  }];
}

export async function createDeepAgentRuntime(
  projectId: string,
  sessionId: string,
  currentMessage: RuntimeInputMessage,
  agentId?: string | null,
  overrides?: RuntimeModelOverrides,
  subagentIds?: string[]  // D-17: agent IDs to configure as subagents
) {
  const releaseWorkingState = conversationWorkingStateLifecycle.beginRuntimeUse();
  try {
    return await buildDeepAgentRuntime(
      projectId,
      sessionId,
      currentMessage,
      agentId,
      overrides,
      subagentIds,
      releaseWorkingState,
    );
  } catch (error) {
    releaseWorkingState();
    throw error;
  }
}

async function buildDeepAgentRuntime(
  projectId: string,
  sessionId: string,
  currentMessage: RuntimeInputMessage,
  agentId: string | null | undefined,
  overrides: RuntimeModelOverrides | undefined,
  subagentIds: string[] | undefined,
  releaseWorkingState: () => void,
) {
  const project = getProject(projectId);
  const agentRow = getRuntimeAgent(projectId, agentId);
  const backend = new CompositeBackend(new StateBackend(), {
    "/": new FilesystemBackend({ rootDir: "/", virtualMode: false }),
  });
  const checkpointer = conversationWorkingStateLifecycle.acquireSaver();
  const agentSkillNames = getAgentSkillNames(agentRow.id);
  const pathContext = extractPathMentionContext(currentMessage.content);
  const messages = await buildInputMessages(sessionId, currentMessage, checkpointer);
  const allMcpServers = getConnectedMcpServers();
  const mcpServers = getAgentMcpServers(agentRow.id);
  const mcpRuntime = await loadMcpTools(agentRow.id, mcpServers, allMcpServers);
  const mcpApprovalToolNames = new Set(getRuntimeToolNames(mcpRuntime.tools));
  const memory = ['AGENTS.md', 'Claude.md']
    .filter((fileName) => fs.existsSync(path.join(project.path, fileName)))
    .map((fileName) => path.join(project.path, fileName))
    .slice(0, 1);

  const builtInTools: any[] = createBuiltInTools(project.path, sessionId);

  try {
    builtInTools.push(...loadRegistryTools());
  } catch (err) {
    console.warn('[RUNTIME] Failed to load built-in tools from registry:', err);
  }


  const currentApprovalMode = (store.get('approvalMode') as ApprovalMode) ?? 'strict';
  // parallel_tasks is added after the shared coordinator is constructed below,
  // but runtime assembly must know the public capability name up front.
  const builtInToolNames = [...getRuntimeToolNames(builtInTools), 'parallel_tasks'];
  console.log('[runtime] built-in tool names:', builtInToolNames.join(', '));
  const runtimeAssembly = await assembleDeepAgentRuntime(
    agentRow,
    undefined,
    project,
    agentSkillNames,
    pathContext,
    builtInToolNames,
    overrides,
  );
  const {
    model,
    provider,
    permissions,
    skillsRuntime,
    systemPrompt,
    assemblyWarnings,
  } = runtimeAssembly;
  for (const warning of assemblyWarnings) {
    console.warn('[runtime] Ignored invalid Skill runtime input:', warning);
  }


  console.log(`[runtime] createDeepAgentRuntime called: projectId=${projectId}, agentId=${agentId}, subagentIds=${JSON.stringify(subagentIds)}`);

  // D-06/D-07/D-17: Build subagents list from subagentIds
  // 如果没有传入 subagentIds，自动查询该项目下的所有 Agent 作为子代理
  let effectiveSubagentIds = subagentIds;
  console.log(`[runtime] effectiveSubagentIds initial: ${JSON.stringify(effectiveSubagentIds)}, !effectiveSubagentIds=${!effectiveSubagentIds}`);
  if (!effectiveSubagentIds || effectiveSubagentIds.length === 0) {
    console.log(`[runtime] Entering auto-discover branch`);
    const allAgents = db.prepare(
      'SELECT id FROM agents WHERE project_id = ? AND id != ?'
    ).all(projectId, agentRow.id) as { id: string }[];
    console.log(`[runtime] Query returned ${allAgents.length} agents`);
    effectiveSubagentIds = allAgents.map(a => a.id);
    console.log(`[runtime] Auto-discovered ${effectiveSubagentIds.length} subagents for project ${projectId}`);
  }

  const subagents: Array<ReturnType<typeof createDelegatedSubagentAdapter>> = [];
  const delegatedTargets = new Map<string, RuntimeAgentRow>();
  const delegatedRunRepository = new DelegatedAgentRunRepository(db);

  const delegatedRuntimeAdapter: DelegatedRuntimeAdapter = {
    run: async (request) => {
      const target = db.prepare('SELECT * FROM agents WHERE id = ? AND project_id = ?')
        .get(request.targetAgentId, projectId) as RuntimeAgentRow | undefined;
      if (!target) {
        throw new Error(`Delegated target Agent not found: ${request.targetAgentSlug}`);
      }

      // Every Delegated Agent Run owns fresh mutable execution state. Agent
      // configuration is reused, but model/graph/backend/checkpoint/tools are not.
      const childBackend = new CompositeBackend(new StateBackend(), {
        "/": new FilesystemBackend({ rootDir: "/", virtualMode: false }),
      });
      const childBuiltInTools = createBuiltInTools(project.path, sessionId);
      try {
        childBuiltInTools.push(...loadRegistryTools());
      } catch (error) {
        log.warn('[runtime] Failed to load delegated built-in tools from registry:', error);
      }
      const targetToolScope = readAgentToolScope(target.config);
      const childScope = selectDelegatedToolScope({
        agentConfig: target.config,
        parentBuiltInToolNames: builtInToolNames,
        childBuiltInTools,
        parentMcpServerIds: mcpServers.map((server) => server.id),
        childMcpServers: getAgentMcpServers(target.id),
      });
      const childMcpRuntime = await loadMcpTools(target.id, childScope.mcpServers, allMcpServers);
      const childSkillNames = getAgentSkillNames(target.id);
      const childToolNames = getRuntimeToolNames([
        ...childMcpRuntime.tools,
        ...childScope.builtInTools,
      ]);
      const childOverrides = resolveDelegatedModelOverrides({
        targetProviderId: target.provider_id,
        targetConfig: target.config,
        parentProviderId: provider.id,
        parentOverrides: overrides,
      });
      const childAssembly = await assembleDeepAgentRuntime(
        target,
        provider.id,
        project,
        childSkillNames,
        extractPathMentionContext(request.goal),
        childToolNames,
        childOverrides,
      );
      for (const warning of childAssembly.assemblyWarnings) {
        log.warn('[runtime] Ignored invalid delegated Agent Skill runtime input:', warning);
      }

      const childInterruptOn = resolveInterruptOn(
        currentApprovalMode,
        getRuntimeToolNames(childMcpRuntime.tools),
      );
      const gatedToolNames = new Set(Object.keys(childInterruptOn));
      const childAgent = createDeepAgent({
        model: childAssembly.model,
        backend: childBackend,
        systemPrompt: childAssembly.systemPrompt || undefined,
        permissions: childAssembly.permissions,
        tools: [...childMcpRuntime.tools, ...childScope.builtInTools],
        middleware: [
          createDelegatedToolApprovalMiddleware(
            delegatedRunCoordinator,
            request.delegatedRunId,
            gatedToolNames,
          ),
          ...createSubagentResilienceMiddleware(
            overrides?.allowedTools,
            targetToolScope.mode === 'narrow'
              ? [
                  ...(targetToolScope.builtInTools ?? []),
                  ...getRuntimeToolNames(childMcpRuntime.tools),
                ]
              : undefined,
          ),
        ],
        responseFormat: DELEGATED_TASK_RESULT_SCHEMA as unknown as NonNullable<
          NonNullable<Parameters<typeof createDeepAgent>[0]>['responseFormat']
        >,
        checkpointer: new MemorySaver(),
      });
      const progressCallbacks = createDelegatedProgressCallbacks(request);
      const invokeChild = () => childAgent.invoke(
        request.input as Parameters<typeof childAgent.invoke>[0],
        {
          signal: request.signal,
          callbacks: progressCallbacks,
          configurable: {
            thread_id: request.delegatedRunId,
            checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
            delegatedRunId: request.delegatedRunId,
          },
        },
      );
      const childResult = await (request.onStep
        ? subagentStepStorage.run({ onStep: request.onStep }, invokeChild)
        : invokeChild()) as unknown as {
        structuredResponse?: unknown;
        messages?: Array<{ content?: unknown }>;
        __interrupt__?: unknown;
        interrupts?: unknown;
      };
      const childInterrupts = childResult.__interrupt__ ?? childResult.interrupts;
      if (Array.isArray(childInterrupts) && childInterrupts.length > 0) {
        throw new Error('Delegated tool approval is not available for this run');
      }
      const structured = DELEGATED_TASK_RESULT_SCHEMA.safeParse(childResult?.structuredResponse);
      if (structured.success) return structured.data;

      const messages = Array.isArray(childResult?.messages) ? childResult.messages : [];
      const lastMessage = messages[messages.length - 1];
      const content = typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content ?? 'Task completed');
      return {
        status: 'success',
        artifacts: [],
        summary: content.slice(0, 2_000),
      } satisfies DelegatedTaskResult;
    },
  };
  const delegatedRunCoordinator = new DelegatedAgentRunCoordinator(
    delegatedRunRepository,
    delegatedRuntimeAdapter,
  );

  // Single and parallel delegation share this coordinator and therefore the
  // same isolated runtime factory, durable identity, and concurrency window.
  try {
    builtInTools.push(createParallelTaskTool(projectId, sessionId, {
      coordinator: delegatedRunCoordinator,
    }));
  } catch (error) {
    log.warn('[runtime] Failed to load parallel task tool:', error);
  }

  if (effectiveSubagentIds && effectiveSubagentIds.length > 0) {
    // Basic ID format validation (accept UUIDs and simple test IDs)
    const ID_REGEX = /^[0-9a-zA-Z_-]+$/;
    for (const subId of effectiveSubagentIds) {
      if (!ID_REGEX.test(subId)) {
        console.warn(`[runtime] Invalid ID format for subagentId: ${subId}`);
        continue;
      }
      const targetAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(subId) as RuntimeAgentRow | undefined;
      if (!targetAgent) continue;

      // CompiledSubAgent is only a routing adapter. It creates no model or graph
      // until one concrete task invocation has a durable Delegated Agent Run.
      const agentSlug = targetAgent.slug || generateSlug(targetAgent.name);
      delegatedTargets.set(agentSlug, targetAgent);
      subagents.push(createDelegatedSubagentAdapter({
        coordinator: delegatedRunCoordinator,
        target: {
          id: targetAgent.id,
          slug: agentSlug,
          name: targetAgent.name,
          description: targetAgent.description || '',
        },
      }));
    }
  }

  const masterAgentTools: any[] = createAgentTools(projectId, { activeAgentId: agentRow.id });

  // Workflow Run（运行即会话）：当本 session 是某个 Workflow Run 的宿主、且当前 Agent
  // 就是该运行的主 Agent 时，注入阶段推进工具 advance_stage（门禁即一次工具审批）。
  const workflowRun = getRunBySessionId(sessionId);
  const isWorkflowMasterAgent = !!workflowRun && workflowRun.master_agent_id === agentRow.id;
  if (isWorkflowMasterAgent) {
    const runId = workflowRun!.id;
    const getRun = () => getWorkflowRun(runId);
    masterAgentTools.push(createAdvanceStageTool({ runId, projectId, getRun }));
    masterAgentTools.push(createStageRouteBlockerTool({ runId, projectId, getRun }));
    masterAgentTools.push(...createTaskGraphTools({ runId, getRun }));
  }

  const interruptOn = resolveInterruptOn(currentApprovalMode, [...mcpApprovalToolNames]);
  if (isWorkflowMasterAgent) {
    // 门禁即一次工具审批：advance_stage 始终拦截，无视全局 approvalMode（含 bypass）。
    (interruptOn as Record<string, unknown>)['advance_stage'] = { allowedDecisions: ['approve', 'reject'] };
  }

  const effectiveSystemPrompt = isWorkflowMasterAgent
    ? `${systemPrompt}${WORKFLOW_RUN_PROMPT}`
    : systemPrompt;

  const deepAgent = createDeepAgent({
    model,
    backend,
    systemPrompt: effectiveSystemPrompt || undefined,
    permissions,
    tools: [...mcpRuntime.tools, ...builtInTools, ...masterAgentTools],
    subagents: subagents.length > 0 ? subagents : undefined,  // D-06/D-17
    middleware: [
      ...getAllowedToolsMiddlewares(overrides?.allowedTools),
      createRecoverableToolErrorMiddleware(),
      modelRetryMiddleware({
        maxRetries: 2,
        retryOn: isTransientRuntimeError,
        onFailure: formatRecoverableModelErrorObservation,
      }),
    ],
    interruptOn: Object.keys(interruptOn).length > 0 ? interruptOn : undefined,
    checkpointer,
    memory: memory.length ? memory : undefined,
  });

  return {
    agentId: agentRow.id,
    agent: deepAgent,
    model,
    inputMessages: messages,
    skillAttributions: skillsRuntime.attributions,
    queueDelegatedRun: (
      parentAgentRunId: string,
      taskToolCallId: string,
      targetAgentSlug: string,
      goal: string,
    ): DelegatedAgentRun | null => {
      const target = delegatedTargets.get(targetAgentSlug);
      if (!target) return null;
      return delegatedRunCoordinator.queueSingle({
        parentAgentRunId,
        targetAgentId: target.id,
        targetAgentSlug,
        targetAgentName: target.name,
        taskToolCallId,
        goal,
      });
    },
    subscribeDelegatedToolApprovals: delegatedRunCoordinator.subscribeToolApprovals.bind(delegatedRunCoordinator),
    subscribeDelegatedRunChanges: delegatedRunCoordinator.subscribeRunChanges.bind(delegatedRunCoordinator),
    resolveDelegatedToolApproval: delegatedRunCoordinator.resolveToolApproval.bind(delegatedRunCoordinator),
    listDelegatedToolApprovalHistory: delegatedRunCoordinator.listToolApprovalHistory.bind(delegatedRunCoordinator),
    cancelDelegatedRuns: delegatedRunCoordinator.cancelParent.bind(delegatedRunCoordinator),
    cleanup: async () => {
      // MCP 连接由 mcpCache 管理，此处不关闭
      releaseWorkingState();
    },
  };
}

export async function createRuntimeModel(
  projectId: string,
  agentId?: string | null,
  overrides?: RuntimeModelOverrides
) {
  const agentRow = getRuntimeAgent(projectId, agentId);
  const { config } = await resolveRuntimeProviderModelConfig(agentRow, overrides);
  registerCdfHarnessProfile(config.providerType, config.model || config.defaultModel, overrides);
  return createLangChainModel(config);
}
