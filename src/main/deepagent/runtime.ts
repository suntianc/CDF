import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { createMiddleware, modelRetryMiddleware, ToolMessage, toolRetryMiddleware } from 'langchain';
import db from '../database';
import { decryptApiKey } from '../security';
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend, registerHarnessProfile } from 'deepagents';
import { createLangChainModel } from './llm-adapter';
import { loadMcpTools } from './mcp-connector';
import { resolveAgentSkillsConfig } from './skill-manager';
import { createDeleteFileTool } from './file-tools';
import { createTavilyTool, createAnysearchTool, type SearchProviderConfig } from './search-tools';
import { createBashTool } from './bash-tool';
import { createFetchTool } from './fetch-tool';
import { createArxivTool } from './arxiv-tool';
import { createWorkflowTools } from '../workflow/tools';
import { DELEGATED_TASK_RESULT_SCHEMA, type MCPServer, type ChatRuntimeOverrides } from '../../shared/types';
// Re-export for DelegatedTaskResultSchema consumers (types.ts)
export { DELEGATED_TASK_RESULT_SCHEMA };

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

// Phase 7 Plan 01: alias to shared ChatRuntimeOverrides (Gap 2 fix). The shared
// type already declares `planOnly?: boolean`, which is consumed in
// createDeepAgentRuntime below for the D-13 plan-mode tool suppression.
type RuntimeModelOverrides = ChatRuntimeOverrides;

interface RuntimeInputMessage {
  id: string;
  content: string;
}

export const DEEPAGENT_CHECKPOINT_NAMESPACE = '';

const DEFAULT_INTERRUPT_ON: NonNullable<Parameters<typeof createDeepAgent>[0]>['interruptOn'] = {
  write_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  edit_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  delete_file: { allowedDecisions: ['approve', 'reject'] },
};

let checkpointSaver: SqliteSaver | null = null;

function getCheckpointSaver(): SqliteSaver {
  if (!checkpointSaver) {
    checkpointSaver = SqliteSaver.fromConnString(path.join(app.getPath('userData'), 'deepagents-checkpoints.db'));
  }
  return checkpointSaver;
}

function normalizeProviderId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return null;
  }
  return trimmed;
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

function getAgentSkillNames(agentId: string): string[] {
  const rows = db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(agentId) as Array<{ skill_name: string }>;
  return rows.map((row) => row.skill_name);
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

function getProvider(providerId: string | null | undefined) {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    throw new Error('默认 Agent 尚未绑定模型提供商。');
  }
  let provider = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(normalizedProviderId) as any;
  if (!provider) {
    // 指定的 provider 已被删除，自动 fallback 到活跃 provider
    provider = db.prepare('SELECT * FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').get() as any;
    if (!provider) {
      provider = db.prepare('SELECT * FROM llm_providers ORDER BY updated_at DESC LIMIT 1').get() as any;
    }
    if (!provider) {
      throw new Error('请先在模型设置中配置并激活一个 LLM 提供商。');
    }
  }
  return {
    ...provider,
    api_key: provider.api_key ? decryptApiKey(provider.api_key) : undefined,
  };
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
  if (await hasCheckpoint(sessionId, checkpointer)) {
    return [{ role: 'user' as const, content: currentMessage.content }];
  }

  const history = getSessionMessages(sessionId);
  const hasCurrent = history.some((message) => message.id === currentMessage.id);
  return [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(hasCurrent ? [] : [{ role: 'user' as const, content: currentMessage.content }]),
  ];
}

function getAgentMcpServers(agentId: string): MCPServer[] {
  const rows = db
    .prepare(`
      SELECT m.*
      FROM mcp_servers m
      INNER JOIN agent_mcp_servers ams ON ams.mcp_server_id = m.id
      WHERE ams.agent_id = ?
      ORDER BY m.updated_at DESC
    `)
    .all(agentId) as Array<Omit<MCPServer, 'config' | 'is_connected'> & { config: string | null; is_connected: number }>;

  return rows.map((row) => ({
    ...row,
    config: row.config ? JSON.parse(row.config) : {},
    is_connected: !!row.is_connected,
  }));
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

function createSubagentResilienceMiddleware() {
  return [
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

  // D-13: plan mode flag. When set, strip bash/delete_file from tools and disable
  // interruptOn so the LLM cannot fire write_file/edit_file/bash (PITFALLS P2).
  const isPlanMode = Boolean(overrides?.planOnly);

  const builtInTools: any[] = [createFetchTool()];
  if (!isPlanMode) {
    builtInTools.push(createDeleteFileTool(project.path));
    builtInTools.push(createBashTool({ workingDir: project.path }));
  }

  // ---- Tool Registry: 注册新工具只需在此添加一行 ----
  const TOOL_REGISTRY = [
    { toolType: 'tavily',    requiresApiKey: true,  create: createTavilyTool },
    { toolType: 'anysearch', requiresApiKey: true,  create: createAnysearchTool },
    { toolType: 'arxiv',     requiresApiKey: false, create: createArxivTool },
  ];

  function loadToolConfig(toolType: string, requiresApiKey: boolean): SearchProviderConfig | null {
    const row = db.prepare(
      requiresApiKey
        ? "SELECT api_key, config FROM tool_configs WHERE tool_type = ? AND is_enabled = 1"
        : "SELECT config FROM tool_configs WHERE tool_type = ? AND is_enabled = 1"
    ).get(toolType) as { api_key?: string | null; config: string | null } | undefined;
    if (!row) return null;
    if (requiresApiKey && !row.api_key) return null;
    return {
      decryptedKey: row.api_key ? decryptApiKey(row.api_key) : '',
      config: row.config ? JSON.parse(row.config) : {},
    };
  }

  try {
    for (const entry of TOOL_REGISTRY) {
      const config = loadToolConfig(entry.toolType, entry.requiresApiKey);
      if (config) {
        const createdTools = entry.create(config);
        builtInTools.push(...(Array.isArray(createdTools) ? createdTools : [createdTools]));
      }
    }
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

  const deepAgent = createDeepAgent({
    model,
    backend,
    systemPrompt: systemPrompt || undefined,
    skills: skillsSources,
    permissions,
    tools: [...mcpRuntime.tools, ...builtInTools],
    subagents: subagents.length > 0 ? subagents : undefined,  // D-06/D-17
    middleware: [createRecoverableToolErrorMiddleware()],
    // D-13: plan mode disables all interrupts so write_file/edit_file cannot
    // be triggered. Combined with the stripped tools array (no bash /
    // delete_file), the agent is fully read-only in plan mode.
    interruptOn: isPlanMode ? false : DEFAULT_INTERRUPT_ON,
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
