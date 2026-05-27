import { z } from 'zod';

// D-03/D-10: Schema for subagent delegated task results
export const DELEGATED_TASK_RESULT_SCHEMA = z.object({
  status: z.enum(['success', 'failure']),
  artifacts: z.array(z.string()),
  summary: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type DelegatedTaskResult = z.infer<typeof DELEGATED_TASK_RESULT_SCHEMA>;

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
  isGit?: boolean;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  agent_id?: string | null;
  parent_session_id?: string | null;
  summary?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  tokens?: number | null;
}

export interface LLMProvider {
  id: string;
  name: string;
  provider_type: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'deepseek' | 'glm' | 'glm-overseas' | 'minimax' | 'minimax-overseas' | 'kimi' | 'qwen' | 'mimo';
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

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  provider_id?: string;
  system_prompt?: string;
  config?: Record<string, unknown>;
  is_default: number;
  mcpServerIds?: string[];
  skillNames?: string[];
  created_at: number;
  updated_at: number;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  scope: 'project' | 'global';
  module?: string;
  entryScript?: string | null;
  resourceFiles: string[];
  script_content: string;
  script_type: 'bash' | 'python' | 'javascript';
  created_at: number;
  updated_at: number;
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version_number: number;
  script_content: string;
  created_at: number;
}

export interface MCPServer {
  id: string;
  name: string;
  server_type: 'stdio' | 'sse';
  config: Record<string, unknown>;
  is_connected: boolean;
  last_health_check?: number;
  created_at: number;
  updated_at: number;
}

export type SearchProviderType = 'tavily' | 'anysearch';

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

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type LLMStreamEvent =
  | { type: 'run_started'; runId: string; agentId: string; status: AgentRunStatus }
  | { type: 'run_updated'; runId: string; status: AgentRunStatus; error?: string }
  | { type: 'message_chunk'; text: string }
  | { type: 'message_done' }
  | { type: 'tool_start'; id?: string; name: string; input?: unknown }
  | { type: 'tool_end'; id?: string; name: string; output?: unknown }
  | { type: 'tool_error'; id?: string; name: string; error: string }
  | { type: 'approval_required'; approval: AgentApprovalRequest }
  | { type: 'approval_resolved'; approvalId: string; status: AgentApprovalStatus }
  | { type: 'runtime_error'; error: string }
  | { type: 'delegated_task_start'; taskId: string; agentSlug: string; agentName: string; goal: string }
  | { type: 'delegated_task_chunk'; taskId: string; text: string }
  | { type: 'delegated_task_end'; taskId: string; status: 'success' | 'failure'; result?: DelegatedTaskResult; errorCode?: string }
  | { type: 'todos_update'; todos: TodoItem[] };

export interface ChatRuntimeOverrides {
  providerId?: string;
  model?: string;
}

export type AgentRunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted';
export type AgentToolCallStatus = 'running' | 'success' | 'error' | 'skipped';
export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited';
export type AgentApprovalDecisionType = 'approve' | 'reject' | 'edit';

export interface AgentRun {
  id: string;
  session_id: string;
  agent_id: string;
  request_id: string;
  status: AgentRunStatus;
  error?: string | null;
  started_at: number;
  ended_at?: number | null;
  aborted: number;
}

export interface AgentToolCall {
  id: string;
  run_id: string;
  tool_name: string;
  input?: string | null;
  output?: string | null;
  status: AgentToolCallStatus;
  error?: string | null;
  approval_status?: AgentApprovalStatus | null;
  started_at: number;
  ended_at?: number | null;
}

export interface AgentApprovalAction {
  name: string;
  args?: unknown;
  description?: string;
  allowedDecisions?: AgentApprovalDecisionType[];
}

export interface AgentApprovalRequest {
  id: string;
  runId: string;
  actions: AgentApprovalAction[];
}

export interface AgentApprovalResolution {
  approvalId: string;
  decisions: Array<{
    type: AgentApprovalDecisionType;
    editedAction?: unknown;
    message?: string;
  }>;
}

export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  db: {
    getProjects: () => Promise<Project[]>;
    createProject: (name: string, projectPath: string) => Promise<Project>;
    deleteProject: (id: string) => Promise<void>;
    getSessions: (projectId: string) => Promise<Session[]>;
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => Promise<Session>;
    deleteSession: (sessionId: string) => Promise<void>;
    getMessages: (sessionId: string) => Promise<Message[]>;
    saveMessage: (message: any) => Promise<Message>;
    deleteMessage: (id: string) => Promise<void>;
    getProviders: () => Promise<LLMProvider[]>;
    saveProvider: (provider: any) => Promise<LLMProvider>;
    deleteProvider: (id: string) => Promise<void>;
    setActiveProvider: (id: string) => Promise<void>;
    selectDirectory: () => Promise<string | null>;
    // Phase 3: Agent Library
    getAgents: (projectId: string) => Promise<Agent[]>;
    saveAgent: (agent: any) => Promise<Agent>;
    deleteAgent: (id: string) => Promise<void>;
    // Phase 3: Skills
    getSkills: (projectId: string) => Promise<Skill[]>;
    saveSkill: (projectId: string, skill: any) => Promise<Skill>;
    deleteSkill: (projectId: string, id: string) => Promise<void>;
    getSkillVersions: (skillId: string) => Promise<SkillVersion[]>;
    getAgentRuns: (sessionId: string) => Promise<AgentRun[]>;
    getAgentToolCalls: (runId: string) => Promise<AgentToolCall[]>;
    // Phase 3: MCP Servers
    getMcpServers: () => Promise<MCPServer[]>;
    saveMcpServer: (server: any) => Promise<MCPServer>;
    deleteMcpServer: (id: string) => Promise<void>;
    checkMcpHealth: (id: string) => Promise<{ ok: boolean; message?: string }>;
    toggleMcpConnection: (id: string, connected: boolean) => Promise<void>;
    selectFile: () => Promise<{ name: string; script_type: 'bash' | 'python' | 'javascript'; content: string } | null>;
    // Phase 4: Tool Configs
    getToolConfigs: () => Promise<SearchProvider[]>;
    saveToolConfig: (config: any) => Promise<SearchProvider>;
    deleteToolConfig: (id: string) => Promise<void>;
  };
  llm: {
    chat: (requestId: string, payload: { projectId: string; sessionId: string; agentId?: string | null; message: { id: string; content: string }; overrides?: ChatRuntimeOverrides }) => Promise<void>;
    stopChat: (requestId: string) => Promise<void>;
    resolveApproval: (requestId: string, resolution: AgentApprovalResolution) => Promise<void>;
    testProvider: (providerId: string) => Promise<{ ok: boolean; message: string }>;
    fetchProviderModels: (providerId: string) => Promise<string[]>;
    fetchOllamaModels: (apiUrl: string) => Promise<string[]>;
    onChunk: (
      requestId: string,
      callback: (event: any, data: LLMStreamEvent) => void
    ) => () => void;
  };
  deepagents: {
    createAgent: (config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }) => Promise<{ agentId: string }>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
