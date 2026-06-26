import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { createMiddleware, modelRetryMiddleware, ToolMessage, toolRetryMiddleware } from 'langchain';
import db from '../database';
import store from '../store';
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend, registerHarnessProfile } from 'deepagents';
import { createLangChainModel } from './llm-adapter';
import { resolveAgentSkillsConfig } from './skill-manager';
import {
  getProvider,
  getAgentMcpServers,
  getAgentSkillNames,
  normalizeProviderId,
  DEFAULT_INTERRUPT_ON,
  createBuiltInTools,
  loadRegistryTools,
  loadMcpTools,
} from './shared-infra';
import { createAgentTools } from './agent-tools';
import { createWorkflowTools } from '../workflow/tools';
import { createParallelTaskTool } from './parallel-task-tool';
import { DELEGATED_TASK_RESULT_SCHEMA, type ApprovalMode, type ChatRuntimeOverrides, type ExecutionStep } from '../../shared/types';
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

let checkpointSaver: SqliteSaver | null = null;

function getCheckpointSaver(): SqliteSaver {
  if (!checkpointSaver) {
    checkpointSaver = SqliteSaver.fromConnString(path.join(app.getPath('userData'), 'deepagents-checkpoints.db'));
  }
  return checkpointSaver;
}

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

function registerCdfHarnessProfile(providerType: string, modelName: string): void {
  const profile = {
    generalPurposeSubagent: { enabled: false },
    excludedTools: [],  // D-15: task tool enabled for subagent delegation
  };

  const registerSafely = (key: string | null | undefined) => {
    const trimmed = key?.trim();
    if (!trimmed || trimmed.split(':').length > 2) return;
    try {
      registerHarnessProfile(trimmed, profile);
    } catch (error) {
      console.warn(`Failed to register DeepAgents harness profile for "${trimmed}":`, error);
    }
  };

  registerSafely(modelName);

  if (providerType === 'anthropic') {
    registerSafely('anthropic');
    if (modelName && !modelName.includes(':')) registerSafely(`anthropic:${modelName}`);
    return;
  }

  if (providerType !== 'ollama') {
    registerSafely('openai');
    if (modelName && !modelName.includes(':')) registerSafely(`openai:${modelName}`);
  }
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

function buildProjectContext(project: RuntimeProjectRow): string {
  return `\n\n[项目上下文]\n当前选中项目名称: ${project.name}\n项目根目录: ${project.path}\n所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径，例如 \`${project.path}/src/main.ts\`。\nbash 工具也使用绝对路径，当前工作目录为项目根目录。\n\n## Skills 创建规范\n- 创建项目级 Skill 时，请写入 \`${project.path}/.cdf/skills/{skill名称}/SKILL.md\`（项目级 skills 对该项目所有 Agent 自动可见）\n- SKILL.md 格式：以 \`---\` 开头的前置元数据，包含 \`name\` 和 \`description\` 字段，随后是 Markdown 正文\n- 全局 Skill 写入 \`~/.cdf/skills/{skill名称}/SKILL.md\`（需要在 Agent 编辑界面绑定后才可见）\n当你需要查看、确认、搜索或继续分析项目时，必须在当前轮次继续调用合适的文件工具；不要只回复”我先看看/我再确认/继续搜索”就结束。`;
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

function isTransientRuntimeError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes('timeout') ||
    name.includes('network') ||
    name.includes('rate') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout')
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
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
        if (isAbortError(error) || request.runtime?.signal?.aborted) {
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
      if (!ctx) return handler(request);

      const toolName: string = request.toolCall?.name || 'unknown';
      const startedAt = Date.now();
      ctx.onStep({ type: 'tool_call', tool: toolName, args: (request.toolCall as any)?.args ?? (request.toolCall as any)?.input, ts: startedAt });

      try {
        const result = await handler(request);
        ctx.onStep({
          type: 'tool_result',
          tool: toolName,
          success: true,
          output: extractStepOutput(result),
          ts: Date.now(),
          duration_ms: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        if (!isAbortError(error)) {
          const errMsg = error instanceof Error ? error.message : String(error);
          ctx.onStep({ type: 'tool_result', tool: toolName, success: false, error: errMsg, ts: Date.now(), duration_ms: Date.now() - startedAt });
        }
        throw error;
      }
    },
  });
}

function createSubagentResilienceMiddleware() {
  return [
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

export async function createDeepAgentRuntime(
  projectId: string,
  sessionId: string,
  currentMessage: RuntimeInputMessage,
  agentId?: string | null,
  overrides?: RuntimeModelOverrides,
  subagentIds?: string[]  // D-17: agent IDs to configure as subagents
) {
  const project = getProject(projectId);
  const agentRow = getRuntimeAgent(projectId, agentId);
  const provider = getProvider(normalizeProviderId(overrides?.providerId) || agentRow.provider_id);
  const modelName = overrides?.model || provider.default_model;
  registerCdfHarnessProfile(provider.provider_type, modelName);
  const model = createLangChainModel({
    apiKey: provider.api_key,
    apiUrl: provider.api_url,
    defaultModel: provider.default_model,
    providerType: provider.provider_type,
    model: modelName,
  });
  const backend = new CompositeBackend(new StateBackend(), {
    "/": new FilesystemBackend({ rootDir: "/", virtualMode: false }),
  });
  const checkpointer = getCheckpointSaver();
  const { skillsSources, permissions } = resolveAgentSkillsConfig(project.path, getAgentSkillNames(agentRow.id));
  const messages = await buildInputMessages(sessionId, currentMessage, checkpointer);
  const mcpServers = getAgentMcpServers(agentRow.id);
  const mcpRuntime = await loadMcpTools(agentRow.id, mcpServers);
  const memory = ['AGENTS.md', 'Claude.md']
    .filter((fileName) => fs.existsSync(path.join(project.path, fileName)))
    .map((fileName) => path.join(project.path, fileName))
    .slice(0, 1);

  const systemPrompt = (agentRow.system_prompt || '') + buildProjectContext(project);

  const builtInTools: any[] = createBuiltInTools(project.path);

  try {
    builtInTools.push(...loadRegistryTools());
  } catch (err) {
    console.warn('[RUNTIME] Failed to load built-in tools from registry:', err);
  }

  // D-16c: 注册工作流工具 — Master Agent 可通过 Chat 触发工作流执行
  try {
    const workflowTools = createWorkflowTools(projectId);
    builtInTools.push(...workflowTools);
  } catch (err) {
    console.warn('[RUNTIME] Failed to load workflow tools:', err);
  }

  // 注册并行任务工具 — MasterAgent 可并发调用多个子 Agent
  const currentApprovalMode = (store.get('approvalMode') as ApprovalMode) ?? 'strict';
  try {
    builtInTools.push(createParallelTaskTool(projectId, sessionId, currentApprovalMode));
  } catch (err) {
    console.warn('[RUNTIME] Failed to load parallel task tool:', err);
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

  const subagents: any[] = [];

  if (effectiveSubagentIds && effectiveSubagentIds.length > 0) {
    // Basic ID format validation (accept UUIDs and simple test IDs)
    const ID_REGEX = /^[0-9a-zA-Z_-]+$/;
    for (const subId of effectiveSubagentIds) {
      if (!ID_REGEX.test(subId)) {
        console.warn(`[runtime] Invalid ID format for subagentId: ${subId}`);
        continue;
      }
      const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(subId) as RuntimeAgentRow | undefined;
      if (!agentRow) continue;

      // D-03: slug is the stable key for task(name)
      const agentSlug = agentRow.slug || generateSlug(agentRow.name);

      const subMcpServers = getAgentMcpServers(agentRow.id);
      const subMcpRuntime = await loadMcpTools(agentRow.id, subMcpServers);
      const { skillsSources: subSkillsSources, permissions: _subPermissions } = resolveAgentSkillsConfig(project.path, getAgentSkillNames(agentRow.id));

      const providerRow = getProvider(normalizeProviderId(agentRow.provider_id) || provider.id);
      const subagentModel = createLangChainModel({
        apiKey: providerRow.api_key,
        apiUrl: providerRow.api_url,
        defaultModel: providerRow.default_model,
        providerType: providerRow.provider_type,
      });

      console.log(`[runtime] Subagent ${agentSlug}: provider_id=${agentRow.provider_id}, default_model=${providerRow?.default_model}, provider_type=${providerRow?.provider_type}`);

      subagents.push({
        name: agentSlug,  // D-03: slug as stable key
        description: agentRow.description || '',
        systemPrompt: agentRow.system_prompt || '',
        tools: [...subMcpRuntime.tools, ...builtInTools],
        skills: subSkillsSources.length > 0 ? subSkillsSources : undefined,
        model: subagentModel,
        middleware: createSubagentResilienceMiddleware(),
        responseFormat: DELEGATED_TASK_RESULT_SCHEMA,
      });
    }
  }

  const masterAgentTools = createAgentTools(projectId, { activeAgentId: agentRow.id });

  const deepAgent = createDeepAgent({
    model,
    backend,
    systemPrompt: systemPrompt || undefined,
    skills: skillsSources,
    permissions,
    tools: [...mcpRuntime.tools, ...builtInTools, ...masterAgentTools],
    subagents: subagents.length > 0 ? subagents : undefined,  // D-06/D-17
    middleware: [createRecoverableToolErrorMiddleware()],
    interruptOn: DEFAULT_INTERRUPT_ON,
    checkpointer,
    memory: memory.length ? memory : undefined,
  });

  return {
    agentId: agentRow.id,
    agent: deepAgent,
    model,
    inputMessages: messages,
    cleanup: async () => {
      // MCP 连接由 mcpCache 管理，此处不关闭
    },
  };
}

export function createRuntimeModel(
  projectId: string,
  agentId?: string | null,
  overrides?: RuntimeModelOverrides
) {
  const agentRow = getRuntimeAgent(projectId, agentId);
  const provider = getProvider(normalizeProviderId(overrides?.providerId) || agentRow.provider_id);
  const modelName = overrides?.model || provider.default_model;
  registerCdfHarnessProfile(provider.provider_type, modelName);
  return createLangChainModel({
    apiKey: provider.api_key,
    apiUrl: provider.api_url,
    defaultModel: provider.default_model,
    providerType: provider.provider_type,
    model: modelName,
    contextLimit: provider.context_limit,
  });
}
