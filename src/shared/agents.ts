export function generateAgentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export const AGENT_BUILT_IN_TOOL_NAMES = [
  'write_todos',
  'read_file',
  'write_file',
  'edit_file',
  'ls',
  'glob',
  'grep',
  'delete_file',
  'bash',
  'fetch',
  'obscura_browse',
  'knowledge_search',
  'knowledge_create',
  'generate_image',
  'generate_video',
  'manage_background_jobs',
  'synthesize_speech',
  'generate_music',
  'tavily_search',
  'anysearch',
  'arxiv_search',
  'arxiv_get_papers',
] as const;

export interface AgentToolScopeConfig {
  mode: 'inherit' | 'narrow';
  builtInTools?: string[];
  mcpServerIds?: string[];
}

export type AgentRole = 'master' | 'general-purpose' | 'custom';

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  slug?: string;
  role?: AgentRole;
  is_protected?: boolean;
  description?: string;
  provider_id?: string;
  system_prompt?: string;
  config?: Record<string, unknown>;
  is_default: number;
  mcpServerExclusionIds?: string[];
  skillNames?: string[];
  created_at: number;
  updated_at: number;
}

// IPC 保存入参：以 db:saveAgent handler 实际消费的字段为真（slug 与时间戳由主进程生成）。
export interface AgentSaveInput {
  id: string;
  project_id: string;
  /** Omit only when updating the protected Master Agent's prompt. */
  name?: string;
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
  is_default?: number | boolean;
  mcpServerExclusionIds?: string[];
  skillNames?: string[];
}

// db:saveAgent 的真实返回：入参回显 + 归一化的 is_default/关联数组（handler 为真）。
export interface AgentSaveResult {
  id: string;
  project_id: string;
  name: string;
  slug?: string;
  role?: AgentRole;
  is_protected?: boolean;
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
  is_default: number;
  mcpServerExclusionIds: string[];
  skillNames: string[];
}
