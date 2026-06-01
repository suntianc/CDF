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
  resourceFiles: string[];
  created_at: number;
  updated_at: number;
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

// ===== Phase 4: Workflow System Types =====

export type WorkflowNodeType = 'start' | 'agent' | 'task' | 'loop' | 'review' | 'foreach' | 'end';
export type WorkflowAgentNodeKind = 'task' | 'loop' | 'review' | 'foreach';
export type WorkflowEdgeOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte';

/** Node port — 统一输入/输出端口定义（参考 Flowise INode） */
export interface NodePort {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  required?: boolean;
  defaultValue?: unknown;
}

/** Node category for palette grouping */
export type WorkflowNodeCategory = 'flow' | 'agent';

/** 统一节点配置接口 */
export interface WorkflowNodeConfig {
  /** 节点分类（用于侧边栏分组） */
  category: WorkflowNodeCategory;
  /** 输入端口定义 */
  inputs: NodePort[];
  /** 输出端口定义 */
  outputs: NodePort[];
  /** 节点图标（lucide icon name） */
  icon?: string;
  /** 节点颜色主题 */
  color?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeKind?: WorkflowAgentNodeKind;
    agentId?: string;
    description?: string;
    taskDescription?: string;
    workspace?: string;
    workArea?: string;
    loopCount?: number;
    reviewSpec?: string;
    reviewRules?: string;
    retryCount?: number;
    failureStrategy?: 'retry' | 'skip' | 'stop';
    taskGoal?: string;
    bgColor?: string;
    dataSource?: string;
    itemPrompt?: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  metadata?: {
    condition?: string;
    operator?: WorkflowEdgeOperator;
    routeValue?: string;
    compareValue?: string;
    targets?: Record<string, string>;
  };
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface Workflow {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  graph_data: WorkflowDefinition;
  status: 'draft' | 'active';
  created_at: number;
  updated_at: number;
}

export type WorkflowExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  project_id: string;
  trigger_source: 'editor' | 'chat' | 'schedule';
  status: WorkflowExecutionStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  started_at: number;
  ended_at?: number;
}

export type WorkflowNodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'stopped';

export interface WorkflowNodeRun {
  id: string;
  execution_id: string;
  node_id: string;
  node_name: string;
  status: WorkflowNodeRunStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  error_type?: string;
  retry_count: number;
  started_at: number;
  ended_at?: number;
  logs?: string[];
}

export type WorkflowStreamEvent = (
  | { type: 'workflow_start'; executionId: string; workflowId: string }
  | { type: 'node_start'; executionId: string; nodeId: string; nodeName: string }
  | { type: 'node_end'; executionId: string; nodeId: string; duration_ms: number; outputKeys: string[] }
  | { type: 'node_error'; executionId: string; nodeId: string; errorType: string; errorMessage: string; retryCount: number }
  | { type: 'workflow_end'; executionId: string; status: 'completed' | 'failed' | 'stopped'; duration_ms: number }
  | { type: 'loop_terminated'; executionId: string; edgeId: string; iterationCount: number }
  | { type: 'node_log'; executionId: string; nodeId: string; log: string }
) & { seq?: number };

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
    importSkillDirectory: (sourceDir: string) => Promise<Skill>;
    getSkillVersions: (skillId: string) => Promise<[]>;  // deprecated, retained for API compat
    getAgentRuns: (sessionId: string) => Promise<AgentRun[]>;
    getAgentToolCalls: (runId: string) => Promise<AgentToolCall[]>;
    getLatestTodos: (sessionId: string) => Promise<any>;
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
    // Phase 4: Workflows
    getWorkflows: (projectId: string) => Promise<Workflow[]>;
    getWorkflow: (id: string) => Promise<Workflow | undefined>;
    saveWorkflow: (workflow: any) => Promise<Workflow>;
    deleteWorkflow: (id: string) => Promise<void>;
    getWorkflowExecutions: (workflowId: string) => Promise<WorkflowExecution[]>;
    getWorkflowExecution: (id: string) => Promise<WorkflowExecution | undefined>;
    getWorkflowNodeRuns: (executionId: string) => Promise<WorkflowNodeRun[]>;
    openFile: (filePath: string, projectId?: string) => Promise<{ success: boolean; error?: string }>;
    revealFile: (filePath: string, projectId?: string) => Promise<{ success: boolean; error?: string; warning?: string }>;
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
  workflow: {
    runWorkflow: (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => Promise<string>;
    stopWorkflow: (executionId: string) => Promise<void>;
    getWorkflowEvents: (executionId: string) => Promise<WorkflowStreamEvent[]>;
    onWorkflowEvent: (executionId: string, callback: (event: any, data: WorkflowStreamEvent) => void) => () => void;
    // 历史执行记录
    listExecutions: (workflowId: string) => Promise<WorkflowExecution[]>;
    deleteExecution: (executionId: string) => Promise<void>;
    exportExecution: (executionId: string) => Promise<{ saved: boolean; path?: string; canceled?: boolean; error?: string }>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
