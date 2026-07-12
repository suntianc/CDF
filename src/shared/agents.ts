export interface Agent {
  id: string;
  project_id: string;
  name: string;
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
  name: string;
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
  description?: string | null;
  provider_id?: string | null;
  system_prompt?: string | null;
  config?: Record<string, unknown> | null;
  is_default: number;
  mcpServerExclusionIds: string[];
  skillNames: string[];
}
