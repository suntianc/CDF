/**
 * shared-infra.ts — Chat 路径与 Workflow 路径的共享能力层
 *
 * Phase 16 Plan 01: 消除 runtime.ts / node-executor.ts 的代码重复。
 * 提取统一的 DB 查询、工具构建、审批配置、span trace 函数。
 *
 * 消费方迁移在 Plan 02 执行，本文件为纯新增模块。
 */

import crypto from 'crypto';
import db from '../database';
import { decryptApiKey } from '../security';
import { createDeleteFileTool } from './file-tools';
import { createBashTool } from './bash-tool';
import { createFetchTool } from './fetch-tool';
import { createObscuraBrowserTool, createObscuraCliRunner } from './obscura-tool';
import { createTavilyTool, createAnysearchTool, type SearchProviderConfig } from './search-tools';
import { createArxivTool } from './arxiv-tool';
import { loadMcpTools } from './mcp-connector';
import type { ApprovalMode, MCPServer } from '../../shared/types';
import { createKnowledgeCreateTool, createKnowledgeSearchTool } from '../knowledge-base';

// Re-export loadMcpTools for consumers that only need shared-infra
export { loadMcpTools };

// ===== Interfaces =====

export interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: string | null;
  is_default?: number;
  created_at?: number;
  updated_at?: number;
}

export interface ProviderRow {
  id: string;
  provider_type: string;
  api_key?: string | null;
  api_url?: string | null;
  default_model: string;
  context_limit?: number | null;
  is_active?: number;
}

// ===== DB 查询函数 =====

/**
 * 按 ID 查询 Agent，未找到时抛出错误
 */
export function getAgentRow(agentId: string): AgentRow {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

/**
 * 查询 Provider，含 decryptApiKey 和 fallback 逻辑。
 * 兼容 runtime.ts 的 getProvider 语义（含 fallback 到活跃 provider）。
 */
export function getProvider(providerId: string | null | undefined): ProviderRow {
  const normalizedId = normalizeProviderId(providerId);
  if (!normalizedId) {
    throw new Error('默认 Agent 尚未绑定模型提供商。');
  }

  let provider = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(normalizedId) as ProviderRow | undefined;

  if (!provider) {
    // 指定 provider 已被删除，自动 fallback 到活跃 provider
    provider = db.prepare('SELECT * FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1').get() as ProviderRow | undefined;
    if (!provider) {
      provider = db.prepare('SELECT * FROM llm_providers ORDER BY updated_at DESC LIMIT 1').get() as ProviderRow | undefined;
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

/**
 * 查询 Agent 绑定的 MCP 服务器列表
 */
export function getAgentMcpServers(agentId: string): MCPServer[] {
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

/**
 * 查询 Agent 的 Skill Preload 引用列表
 */
export function getAgentSkillNames(agentId: string): string[] {
  const rows = db
    .prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?')
    .all(agentId) as Array<{ skill_name: string }>;
  return rows.map((row) => row.skill_name);
}

// ===== 辅助函数 =====

/**
 * 规范化 provider ID：null/undefined/'undefined'/'null'/空白字符串 → null
 */
export function normalizeProviderId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return null;
  }
  return trimmed;
}

// ===== 审批配置 =====

/**
 * 默认审批拦截配置 — 单一来源（消除 runtime.ts:56 / node-executor.ts:29 的重复定义）
 */
export const DEFAULT_INTERRUPT_ON: Record<string, { allowedDecisions: ('approve' | 'reject' | 'edit')[] }> = {
  write_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  edit_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  delete_file: { allowedDecisions: ['approve', 'reject'] },
  delete_agent: { allowedDecisions: ['approve', 'reject'] },
  update_agent: { allowedDecisions: ['approve', 'edit', 'reject'] },
  create_agent: { allowedDecisions: ['approve', 'edit', 'reject'] },
};

/**
 * 根据审批模式决定 interruptOn 值：
 * - bypass: {} (不拦截)
 * - strict / agent_decides: DEFAULT_INTERRUPT_ON (全量拦截)
 */
export function resolveInterruptOn(
  mode: ApprovalMode,
): Record<string, { allowedDecisions: ('approve' | 'reject' | 'edit')[] }> | Record<string, never> {
  if (mode === 'bypass') return {};
  return DEFAULT_INTERRUPT_ON;
}

// ===== 工具构建函数 =====

/**
 * 构建内建工具（delete_file、bash、fetch），绑定到指定工作目录
 */
export function createBuiltInTools(workingDir: string): any[] {
  return [
    createDeleteFileTool(workingDir),
    createBashTool({ workingDir }),
    createFetchTool(),
    createObscuraBrowserTool({ runner: createObscuraCliRunner() }),
    createKnowledgeSearchTool(workingDir),
    createKnowledgeCreateTool(workingDir),
  ];
}

/**
 * 工具注册表条目类型
 */
interface ToolRegistryEntry {
  toolType: string;
  requiresApiKey: boolean;
  create: (config: SearchProviderConfig) => any | any[];
}

const TOOL_REGISTRY: ToolRegistryEntry[] = [
  { toolType: 'tavily',    requiresApiKey: true,  create: createTavilyTool },
  { toolType: 'anysearch', requiresApiKey: true,  create: createAnysearchTool },
  { toolType: 'arxiv',     requiresApiKey: false, create: createArxivTool },
];

function loadToolConfig(toolType: string, requiresApiKey: boolean): SearchProviderConfig | null {
  const row = db.prepare(
    requiresApiKey
      ? 'SELECT api_key, config FROM tool_configs WHERE tool_type = ? AND is_enabled = 1'
      : 'SELECT config FROM tool_configs WHERE tool_type = ? AND is_enabled = 1',
  ).get(toolType) as { api_key?: string | null; config: string | null } | undefined;

  if (!row) return null;
  if (requiresApiKey && !row.api_key) return null;

  return {
    decryptedKey: row.api_key ? decryptApiKey(row.api_key) : '',
    config: row.config ? JSON.parse(row.config) : {},
  };
}

/**
 * 从 DB tool_configs 加载已启用的搜索工具（tavily、anysearch、arxiv）
 */
export function loadRegistryTools(): any[] {
  const tools: any[] = [];
  try {
    for (const entry of TOOL_REGISTRY) {
      const config = loadToolConfig(entry.toolType, entry.requiresApiKey);
      if (config) {
        const created = entry.create(config);
        tools.push(...(Array.isArray(created) ? created : [created]));
      }
    }
  } catch (err) {
    console.warn('[shared-infra] Failed to load registry tools:', err);
  }
  return tools;
}

// ===== Span Trace 工具函数 =====

/**
 * 生成 8 字符 hex span ID
 */
export function createSpanId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * 创建子 span，关联父 span ID
 */
export function createChildSpan(parentSpanId: string): { spanId: string; parentSpanId: string } {
  return {
    spanId: createSpanId(),
    parentSpanId,
  };
}
