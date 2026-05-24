import crypto from 'crypto';
import db from '../database';
import { decryptApiKey } from '../security';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { createLangChainModel } from './llm-adapter';
import { loadMcpTools } from './mcp-connector';
import { resolveAgentSkillsConfig } from './skill-manager';
import type { MCPServer } from '../../shared/types';

interface RuntimeAgentRow {
  id: string;
  project_id: string;
  name: string;
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
  path: string;
}

interface RuntimeModelOverrides {
  providerId?: string;
  model?: string;
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

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function getProject(projectId: string): RuntimeProjectRow {
  const project = db.prepare('SELECT id, path FROM projects WHERE id = ?').get(projectId) as RuntimeProjectRow | undefined;
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

function getSessionMessages(sessionId: string) {
  return db.prepare("SELECT role, content FROM messages WHERE session_id = ? AND role != 'system' ORDER BY created_at ASC").all(sessionId) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

function getSessionSummary(sessionId: string): string | null {
  const row = db.prepare('SELECT summary FROM sessions WHERE id = ?').get(sessionId) as { summary?: string | null } | undefined;
  return row?.summary || null;
}

function buildMessages(sessionId: string) {
  const history = getSessionMessages(sessionId);
  const summary = getSessionSummary(sessionId);
  const recentMessages = summary ? history.slice(-20) : history;
  return {
    summary,
    messages: [
      ...(summary ? [{ role: 'system' as const, content: `会话摘要：\n${summary}` }] : []),
      ...recentMessages,
    ],
  };
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

export async function createDeepAgentRuntime(
  projectId: string,
  sessionId: string,
  overrides?: RuntimeModelOverrides
) {
  const project = getProject(projectId);
  const agentRow = ensureDefaultAgent(projectId);
  const provider = getProvider(normalizeProviderId(overrides?.providerId) || agentRow.provider_id);
  const model = createLangChainModel({
    apiKey: provider.api_key,
    apiUrl: provider.api_url,
    defaultModel: provider.default_model,
    providerType: provider.provider_type,
    model: overrides?.model,
  });
  const backend = new FilesystemBackend({ rootDir: project.path });
  const { skillsSources, permissions } = resolveAgentSkillsConfig(project.path);
  const { summary, messages } = buildMessages(sessionId);
  const mcpServers = getAgentMcpServers(agentRow.id);
  const mcpRuntime = await loadMcpTools(agentRow.id, mcpServers);

  const projectContext = `\n\n[项目上下文]\n当前选中项目名称: ${project.name}\n当前选中项目路径: ${project.path}\n请注意：你当前处于此项目上下文中。你通过工具所进行的文件和目录操作（如读取、写入、查询等）都应该以此项目路径为基础。`;
  const systemPrompt = (agentRow.system_prompt || '') + projectContext;

  const deepAgent = createDeepAgent({
    model,
    backend,
    systemPrompt: systemPrompt || undefined,
    skills: skillsSources,
    permissions,
    tools: mcpRuntime.tools,
  });

  return {
    agent: deepAgent,
    inputMessages: messages,
    existingSummary: summary,
    cleanup: async () => {
      // MCP 连接由 mcpCache 管理，此处不关闭
    },
  };
}

export function persistSessionSummary(sessionId: string, summary: string | null) {
  if (!summary) return;
  db.prepare('UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?').run(summary, Date.now(), sessionId);
}

export function extractSummaryFromState(state: any): string | null {
  const message = state?._summarizationEvent?.summaryMessage;
  if (!message) return null;
  return extractText(message.content);
}
