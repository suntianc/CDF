import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import db from '../database';
import { decryptApiKey } from '../security';
import { createDeepAgent, FilesystemBackend, registerHarnessProfile } from 'deepagents';
import { createLangChainModel } from './llm-adapter';
import { loadMcpTools } from './mcp-connector';
import { resolveAgentSkillsConfig } from './skill-manager';
import { createDeleteFileTool } from './file-tools';
import { createTavilyTool, createAnysearchTool, type SearchProviderConfig } from './search-tools';
import { createBashTool } from './bash-tool';
import { createFetchTool } from './fetch-tool';
import { DELEGATED_TASK_RESULT_SCHEMA, type MCPServer } from '../../shared/types';
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

interface RuntimeModelOverrides {
  providerId?: string;
  model?: string;
}

interface RuntimeInputMessage {
  id: string;
  content: string;
}

export const DEEPAGENT_CHECKPOINT_NAMESPACE = 'cdf-master-runtime-v3';

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
  return `\n\n[项目上下文]\n当前选中项目名称: ${project.name}\n文件工具中的项目根目录已经挂载为虚拟路径 \`/\`。\n使用 ls、read_file、write_file、edit_file、glob、grep、delete_file 时，路径必须基于这个虚拟根目录，例如 \`/src/main.ts\` 或 \`/README.md\`。\n不要在文件工具参数中包含宿主机真实路径、用户主目录路径或项目目录前缀。\n当你需要查看、确认、搜索或继续分析项目时，必须在当前轮次继续调用合适的文件工具；不要只回复”我先看看/我再确认/继续搜索”就结束。如果路径不对，先用 \`ls\` 读取 \`/\` 或用 \`glob\` 搜索候选文件来自行恢复。`;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
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
  const backend = new FilesystemBackend({ rootDir: project.path, virtualMode: true });
  const checkpointer = getCheckpointSaver();
  const { skillsSources, permissions } = resolveAgentSkillsConfig(project.path, getAgentSkillNames(agentRow.id));
  const messages = await buildInputMessages(sessionId, currentMessage, checkpointer);
  const mcpServers = getAgentMcpServers(agentRow.id);
  const mcpRuntime = await loadMcpTools(agentRow.id, mcpServers);
  const memory = ['AGENTS.md', 'Claude.md']
    .filter((fileName) => fs.existsSync(path.join(project.path, fileName)))
    .map((fileName) => `/${fileName}`)
    .slice(0, 1);

  const systemPrompt = (agentRow.system_prompt || '') + buildProjectContext(project);

  const builtInTools: any[] = [createDeleteFileTool(project.path), createBashTool(), createFetchTool()];

  function loadSearchProviderConfig(toolType: string): SearchProviderConfig | null {
    const row = db.prepare(
      "SELECT api_key, config FROM tool_configs WHERE tool_type = ? AND is_enabled = 1"
    ).get(toolType) as { api_key: string | null; config: string | null } | undefined;
    if (!row || !row.api_key) return null;
    return {
      decryptedKey: decryptApiKey(row.api_key),
      config: row.config ? JSON.parse(row.config) : {},
    };
  }

  try {
    const tavilyConfig = loadSearchProviderConfig('tavily');
    console.log('[DEBUG] tavilyConfig:', tavilyConfig);
    if (tavilyConfig) {
      builtInTools.push(createTavilyTool(tavilyConfig));
    }

    const anysearchConfig = loadSearchProviderConfig('anysearch');
    console.log('[DEBUG] anysearchConfig:', anysearchConfig);
    if (anysearchConfig) {
      builtInTools.push(createAnysearchTool(anysearchConfig));
    }
  } catch (err) {
    console.warn('[RUNTIME] Failed to load built-in search tools config:', err);
  }

  // D-06/D-07/D-17: Build subagents list from subagentIds
  const subagents: Array<{
    name: string;
    description?: string;
    systemPrompt: string;
    tools: any[];
    model?: string;
    responseFormat: z.ZodType;
  }> = [];

  if (subagentIds && subagentIds.length > 0) {
    // UUID v4 format validation regex
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const subId of subagentIds) {
      if (!UUID_REGEX.test(subId)) {
        console.warn(`[runtime] Invalid UUID format for subagentId: ${subId}`);
        continue;
      }
      const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(subId) as RuntimeAgentRow | undefined;
      if (!agentRow) continue;

      // D-03: slug is the stable key for task(name)
      const agentSlug = agentRow.slug || generateSlug(agentRow.name);

      const subMcpServers = getAgentMcpServers(agentRow.id);
      const subMcpRuntime = await loadMcpTools(agentRow.id, subMcpServers);
      const { skillsSources: subSkillsSources, permissions: subPermissions } = resolveAgentSkillsConfig(project.path, getAgentSkillNames(agentRow.id));

      subagents.push({
        name: agentSlug,  // D-03: slug as stable key
        description: agentRow.description || '',
        systemPrompt: (agentRow.system_prompt || '') + `\n\n你必须返回符合以下 JSON Schema 的结果，不要返回 JSON 以外的任何内容：${JSON.stringify({ type: 'object', properties: { status: { type: 'string', enum: ['success', 'failure'] }, artifacts: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } }, required: ['status', 'artifacts', 'summary'] })}`,
        tools: [...subMcpRuntime.tools],
        model: agentRow.provider_id ? (db.prepare('SELECT default_model FROM llm_providers WHERE id = ?').get(agentRow.provider_id) as { default_model: string } | undefined)?.default_model : undefined,
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
