export interface LLMProvider {
  id: string;
  name: string;
  provider_type: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'deepseek' | 'zhipu' | 'glm-overseas' | 'minimax' | 'minimax-overseas' | 'moonshot' | 'qwen' | 'xiaomimimo';
  api_key?: string;
  api_url?: string;
  default_model: string;
  context_limit: number;
  is_active: number;
  hasKey?: boolean;
  models?: string[];
  created_at: number;
  updated_at: number;
}

// IPC 保存入参：以 db:saveProvider handler 实际消费的字段为真。
// api_key 传 '••••••••' 表示保留已存密钥；created_at/updated_at 由主进程生成。
export interface LLMProviderSaveInput {
  id: string;
  name: string;
  provider_type: LLMProvider['provider_type'];
  api_key?: string;
  api_url?: string;
  default_model: string;
  context_limit: number;
  is_active: number | boolean;
  models?: string[];
}

// db:saveProvider 的真实返回：不含 created_at/updated_at/api_key（handler 为真）。
export interface LLMProviderSaveResult {
  id: string;
  name: string;
  provider_type: LLMProvider['provider_type'];
  api_url?: string;
  default_model: string;
  context_limit: number;
  is_active: number | boolean;
  models?: string[];
  hasKey: boolean;
}

export interface MCPServer {
  id: string;
  name: string;
  server_type: 'stdio' | 'sse' | 'http';
  config: Record<string, unknown>;
  is_connected: boolean;
  last_health_check?: number;
  created_at: number;
  updated_at: number;
}

export type SearchProviderType = 'tavily' | 'anysearch';

// IPC 保存入参：以 db:saveMcpServer handler 实际消费的字段为真。
export interface MCPServerSaveInput {
  id: string;
  name: string;
  server_type: MCPServer['server_type'];
  config?: Record<string, unknown> | null;
}

// db:saveMcpServer 的真实返回：新建/更新后连接状态一律回报 false（handler 为真）。
export interface MCPServerSaveResult {
  id: string;
  name: string;
  server_type: MCPServer['server_type'];
  config?: Record<string, unknown> | null;
  is_connected: boolean;
}

// IPC 保存入参：以 db:saveToolConfig handler 实际消费的字段为真。
// api_key 传 '••••••••' 表示保留已存密钥。
export interface SearchProviderSaveInput {
  id: string;
  tool_type: SearchProviderType;
  name: string;
  api_key?: string;
  config?: Record<string, unknown> | null;
  is_enabled?: number | boolean;
  is_default?: number | boolean;
}

// db:saveToolConfig 的真实返回：不含时间戳与 api_key（handler 为真）。
export interface SearchProviderSaveResult {
  id: string;
  tool_type: SearchProviderType;
  name: string;
  config?: Record<string, unknown> | null;
  is_enabled: boolean;
  is_default: boolean;
  hasKey: boolean;
}

export interface SearchProvider {
  id: string;
  tool_type: SearchProviderType;  // 'tavily' | 'anysearch'
  name: string;
  api_key?: string;
  config?: Record<string, unknown>;
  is_enabled: boolean;
  is_default: boolean;
  hasKey?: boolean;
  created_at: number;
  updated_at: number;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  source: SearchProviderType;
  score: number;
  published_at?: string;
}
