import { z } from 'zod';
import type {
  AISubscriptionCapabilityRoute,
  AISubscriptionEntry,
  AISubscriptionEntryId,
  AISubscriptionLoginStartResult,
  AISubscriptionLoginPollResult,
  CapabilityId,
  ReasoningEffort,
} from './ai-subscriptions';
import type { SkillEffectiveVisibility, SkillModelDiscovery, SkillOverrideState, SkillVisibilitySource } from './skill-overrides';

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

export type ProjectScene = 'general' | 'research';

export interface Project {
  id: string;
  name: string;
  path: string;
  scene: ProjectScene;
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
  think_duration_seconds?: number | null;
  imageBase64?: string[];
}

// IPC 保存入参：以 db:saveMessage handler 实际消费的字段为真（created_at 由主进程生成）。
export interface MessageSaveInput {
  id: string;
  session_id: string;
  role: Message['role'];
  content: string;
  tokens?: number | null;
  think_duration_seconds?: number | null;
  imageBase64?: string[];
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

export interface Skill {
  id: string;
  name: string;
  qualifiedName?: string;
  description?: string;
  scope: 'project' | 'global';
  sourceKind?: SkillCommandSourceKind;
  sourceLabel?: string;
  sourcePath?: string;
  skillPath?: string;
  skillVisibility?: SkillEffectiveVisibility;
  visibilitySource?: SkillVisibilitySource;
  modelDiscovery?: SkillModelDiscovery;
  userInvocable?: boolean;
  editable?: boolean;
  resourceFiles: string[];
  created_at: number;
  updated_at: number;
  shadowedSkills?: SkillShadowedEntry[];
}

export interface SkillShadowedEntry {
  name: string;
  qualifiedName?: string;
  sourceKind?: SkillCommandSourceKind;
  sourceLabel?: string;
  sourcePath?: string;
  skillPath?: string;
}

export type SkillAttributionPhase =
  | 'model-discovery'
  | 'preload'
  | 'explicit-invocation'
  | 'model-triggered';

export interface SkillAttribution {
  phase: SkillAttributionPhase;
  name: string;
  qualifiedName: string;
  sourceKind: SkillCommandSourceKind;
  sourceLabel: string;
  skillPath: string;
  visibility: SkillEffectiveVisibility;
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
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
  | { type: 'skill_attribution'; attributions: SkillAttribution[] }
  | { type: 'approval_required'; approval: AgentApprovalRequest }
  | { type: 'approval_resolved'; approvalId: string; status: AgentApprovalStatus }
  | { type: 'runtime_error'; error: string; errorCode?: string; errorMessageKey?: string; errorMessageParams?: Record<string, string | number> }
  | { type: 'delegated_task_start'; taskId: string; agentSlug: string; agentName: string; goal: string }
  | { type: 'delegated_task_chunk'; taskId: string; text: string }
  | { type: 'delegated_task_end'; taskId: string; status: 'success' | 'failure'; result?: DelegatedTaskResult; errorCode?: string }
  | { type: 'delegated_task_step'; taskId: string; step: ExecutionStep }
  | { type: 'todos_update'; todos: TodoItem[] };

// ===== Phase 6: Slash Command Registry Types (D-01, D-06, D-07) =====

/** D-06 priority order. Declaration order is informational only — actual
 *  priority numbers live in renderer useCommandRegistry.ts. */
export type CommandSource =
  | 'system'
  | 'mcp'
  | 'skill:project'
  | 'skill:global'
  | 'workflow'
  | 'cmd:project'
  | 'cmd:system';

export type SkillCommandSourceKind =
  | 'built-in'
  | 'project'
  | 'project-nested'
  | 'project-additional'
  | 'user'
  | 'enterprise';

export interface SlashCommand {
  /** Command name without the leading `/` */
  name: string;
  /** One-line description. MCP tools collect but do not render (D-09). */
  description: string;
  /** Where this command was registered from. */
  source: CommandSource;
  /** Dispatch target: system enum key / MCP tool name / skill id / workflow id / command file path. */
  target: string;
  /** Display label for source discrimination. */
  sourceLabel: string;
  /** Source badge text rendered in popup, e.g. `[system]`, `[mcp:arxiv_search]`. */
  badge: string;
  /** Skill short name. Present for Skill commands. */
  skillName?: string;
  /** Skill invocation name without the leading `/`; may include a qualified prefix. */
  qualifiedName?: string;
  /** Resolved Skill source kind. Present for Skill commands. */
  skillSourceKind?: SkillCommandSourceKind;
  /** Directory that contributed the Skill. Present for Skill commands. */
  sourcePath?: string;
  /** Absolute path to the Skill's SKILL.md. Present for Skill commands. */
  skillPath?: string;
  /** Effective Skill Override state. Present for Skill commands. */
  skillVisibility?: SkillEffectiveVisibility;
  /** Effective model-discovery exposure. Present for Skill commands. */
  modelDiscovery?: SkillModelDiscovery;
  /** Whether this Skill can be explicitly invoked by the user. Present for Skill commands. */
  userInvocable?: boolean;
  /** Optional arg hint for custom commands (D-20). */
  argumentHint?: string;
  /** D-05: absolute path to the .md file. Set for cmd:project / cmd:system;
   *  absent for system-hardcoded / mcp / skill / workflow entries. */
  bodyPath?: string;
  /** D-07: parsed frontmatter object; absent for system-hardcoded commands. */
  frontmatter?: ParsedFrontmatter;
  /** 08.2 polish: when true, the command is omitted from the `/` popup
   *  rendering — typically because a persistent UI affordance (e.g. the
   *  ContextButton 📊) already exposes the same action. Slash input
   *  (`/cmd …`) still dispatches via the dispatcher. Default: false. */
  hideFromPopup?: boolean;
}

/** D-07 / D-10: typed frontmatter fields supported in custom command `.md` files.
 *  Field names are camelCase (consumer side); they map 1:1 to the kebab-case
 *  keys used in the frontmatter YAML (e.g. `disable-model-invocation`).
 *  Defaults are applied at parse time per D-10. */
export interface ParsedFrontmatter {
  /** Default: false (D-10) */
  disableModelInvocation?: boolean;
  /** Default: true (D-10) */
  userInvocable?: boolean;
  /** Default: [] — empty means all tools available (D-10) */
  allowedTools?: string[];
  /** Default: "" — empty means no soft hint (D-10) */
  whenToUse?: string;
  /** D-02: declaration of $name placeholders used in body. Default: [] */
  arguments?: string[];
}

/** D-01 four dispatch kinds. args is always a passthrough string (D-02).
 *  08.2 extensions: GoalLoop kind (C1-05). */
export type CommandDispatchAction =
  | { kind: 'SystemSilent'; command: SlashCommand; args: string }
  | { kind: 'SystemLocal'; command: SlashCommand; args: string }
  | { kind: 'PluginRewrite'; command: SlashCommand; args: string; prompt: string }
  | { kind: 'GoalLoop'; command: SlashCommand; args: string; goal: string };

/** D-07 lock: build phase RETURNS errors (does NOT throw). Renderer consumes
 *  the array to fire sonner toasts; both rows are preserved (D-05). */
export class CommandConflictError extends Error {
  constructor(
    public readonly commandName: string,
    public readonly conflicts: ReadonlyArray<{ source: CommandSource; badge: string }>
  ) {
    super(`Command conflict: ${commandName} registered from ${conflicts.length} sources`);
    this.name = 'CommandConflictError';
  }
}

// ===== Phase 08.3: @Mention file candidate types (E-01, B-04) =====
// Minimal payload — renderer infers `kind` from `path.endsWith('/')`.
// `truncated: true` signals the popup should display a banner.
export interface AtMentionCandidateList {
  candidates: string[];
  truncated: boolean;
}

// Phase 08.3 fix #8+#9+#14: shared constant so the cap is enforced in one
// place. The main-side BFS caps results at this number; the store's
// defensive slice and the truncated-banner string both reference it.
export const MAX_AT_MENTION_CANDIDATES = 5000;

export type ConversationModelSourceType = 'llm_provider' | 'ai_subscription';

export interface ChatRuntimeOverrides {
  modelSource?: ConversationModelSourceType;
  sourceId?: string;
  providerId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** D-09: frontmatter `allowed-tools` whitelist. Non-empty lists are enforced
   *  at runtime by the deepagent tool-call middleware. Empty/absent means all
   *  otherwise available tools remain available. */
  allowedTools?: string[];
}

export interface MCPToolDetail {
  tool: string;
  server: string;
  tokens: number;
}

export interface SkillDetail {
  name: string;
  scope: 'global' | 'project';
  tokens: number;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  tokens: number;
}

export interface SystemToolDetail {
  name: string;
  tokens: number;
}

export interface ProjectCommandDetail {
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
  systemPrompt: number;
  systemTools: number;
  customAgents: number;
  memoryFiles: number;
  messages: number;
  projectCommandBodies: number;
  freeSpace: number;
  autocompactBuffer: number;
  mcpPerTool: MCPToolDetail[];
  skillsPerSkill: SkillDetail[];
  workflowsPerWorkflow: WorkflowDetail[];
  systemToolsPerTool: SystemToolDetail[];
  projectCommandsPerFile: ProjectCommandDetail[];
}

export interface ContextAggregate {
  breakdown: ContextBreakdown;
  total: number;
  modelName: string;
  contextLimit: number;
  used: number;
  usedPct: number;
  freePct: number;
  mcpPerTool: MCPToolDetail[];
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

// ===== File Management Types =====

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface FileContent {
  content: string;
  encoding: string;
  size: number;
  mtimeMs: number;
}

export interface BinaryFileInfo {
  binary: true;
  size: number;
  mtimeMs: number;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface FileError {
  code: string;
  message: string;
}

// ===== Phase 4: Workflow System Types =====

export type WorkflowNodeType = 'start' | 'agent' | 'task' | 'loop' | 'review' | 'foreach' | 'parallel' | 'end';
export type WorkflowAgentNodeKind = 'task' | 'loop' | 'review' | 'foreach' | 'parallel';
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
    concurrencyLimit?: number;
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

export type WorkflowNodeRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'stopped' | 'waiting';

// ===== 时序执行轨迹 =====

export type ExecutionStepType =
  | 'task_start' | 'task_end'
  | 'thinking'
  | 'text'
  | 'text_chunk'
  | 'tool_call' | 'tool_result'
  | 'system' | 'validation';

export interface ExecutionStep {
  type: ExecutionStepType;
  ts: number;
  label?: string;       // task_start: agent 显示名
  goal?: string;        // task_start: 任务描述（原始 description，不含附加上下文）
  summary?: string;     // task_end: worker 最终输出的简短摘要
  content?: string;     // thinking / system
  tool?: string;        // tool_call / tool_result
  args?: unknown;       // tool_call
  success?: boolean;    // tool_result / task_end
  output?: unknown;     // tool_result(成功)
  error?: string;       // tool_result(失败) / task_end(失败)
  duration_ms?: number; // tool_result
  spanId?: string;       // 当前步骤的 span 标识
  parentSpanId?: string; // 父级 span 标识
}

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
  logs?: string[];                  // 保留(向后兼容)
  execution_trace?: ExecutionStep[]; // 新增:时序执行轨迹
}

// ===== Phase 14: 审批模式 =====

/** 全局审批模式：strict = 全量 DEFAULT_INTERRUPT_ON；agent_decides = 提示词引导；bypass = 不拦截 */
export type ApprovalMode = 'strict' | 'agent_decides' | 'bypass';

/** 工作流审批请求 */
export interface WorkflowApprovalRequest {
  id: string;
  executionId: string;
  nodeId: string;
  actions: AgentApprovalAction[];
}

/** 工作流审批决策 */
export interface WorkflowApprovalResolution {
  approvalId: string;
  decisions: Array<{
    type: AgentApprovalDecisionType;
    editedAction?: unknown;
    message?: string;
  }>;
}

export type WorkflowStreamEvent = (
  | { type: 'workflow_start'; executionId: string; workflowId: string }
  | { type: 'node_start'; executionId: string; nodeId: string; nodeName: string; spanId?: string }
  | { type: 'node_end'; executionId: string; nodeId: string; duration_ms: number; outputKeys: string[] }
  | { type: 'node_error'; executionId: string; nodeId: string; errorType: string; errorMessage: string; retryCount: number }
  | { type: 'workflow_end'; executionId: string; status: 'completed' | 'failed' | 'stopped'; duration_ms: number }
  | { type: 'loop_terminated'; executionId: string; edgeId: string; iterationCount: number }
  | { type: 'node_log'; executionId: string; nodeId: string; step: ExecutionStep }
  // ===== Phase 14 新增：HITL 审批事件 =====
  | { type: 'node_waiting_approval'; executionId: string; nodeId: string; nodeName: string; approval: WorkflowApprovalRequest }
  | { type: 'node_approval_resolved'; executionId: string; nodeId: string; status: 'approved' | 'rejected' }
) & { seq?: number };

export interface KnowledgeEntrySearchOptions {
  keyword?: string;
  tags?: string[];
  tagMatch?: 'all' | 'any';
  dateField?: 'timestamp';
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'timestamp' | 'title';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export interface KnowledgeEntrySummary {
  relativePath: string;
  title?: string;
  tags: string[];
  body: string;
  frontmatter: Record<string, unknown>;
  warnings: string[];
  invalidFrontmatter: boolean;
}

export interface JournalMetricsSnapshot {
  impactFactor?: number | string;
  casTier?: string;
  jcrQuartile?: string;
  indexing?: string[];
  year: number | string;
  source: string;
}

export const PAPER_SEARCH_CONFIG_KEYS = [
  'SEMANTIC_SCHOLAR_API_KEY',
  'UNPAYWALL_EMAIL',
  'CORE_API_KEY',
  'WOS_API_KEY',
  'PUBMED_API_KEY',
  'ELSEVIER_API_KEY',
  'IEEE_API_KEY',
  'EASYSCHOLAR_KEY',
  'SPRINGER_API_KEY',
  'SPRINGER_OPENACCESS_API_KEY',
  'WILEY_TDM_TOKEN',
  'CROSSREF_MAILTO',
  'OPENAIRE_API_KEY',
] as const;

export type PaperSearchConfigKey = typeof PAPER_SEARCH_CONFIG_KEYS[number];
export type PaperSearchConfigSource = 'user_config' | 'environment' | 'missing';

export interface PaperSearchConfigEntry {
  key: PaperSearchConfigKey;
  configured: boolean;
  value: string;
  source: PaperSearchConfigSource;
  secret: boolean;
}

export interface PaperSearchConfigSettings {
  configPath: string;
  entries: PaperSearchConfigEntry[];
  configuredCount: number;
  totalCount: number;
}

export interface KnowledgeEntryCreateInput {
  relativePath?: string;
  type?: string;
  title: string;
  description?: string;
  resource?: string;
  authors?: string[];
  source?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  year?: string | number;
  doi?: string;
  journalMetrics?: JournalMetricsSnapshot;
  tags?: string[];
  body?: string;
}

export interface KnowledgeEntryUpdateInput {
  type?: string;
  title?: string;
  description?: string;
  resource?: string;
  authors?: string[];
  source?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  year?: string | number;
  doi?: string;
  journalMetrics?: JournalMetricsSnapshot;
  tags?: string[];
  body?: string;
}

export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  aiSubscriptions: {
    getEntries: () => Promise<AISubscriptionEntry[]>;
    getActiveLogins: () => Promise<Partial<Record<
      Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
      AISubscriptionLoginStartResult['descriptor']
    >>>;
    setCapabilityEnabled: (
      entryId: AISubscriptionEntryId,
      capabilityId: CapabilityId,
      enabled: boolean
    ) => Promise<AISubscriptionEntry[]>;
    connectWithKey: (entryId: AISubscriptionEntryId, subscriptionKey: string) => Promise<AISubscriptionEntry[]>;
    startLogin: (
      entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>
    ) => Promise<AISubscriptionLoginStartResult>;
    pollLogin: (
      entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
      attemptId: string
    ) => Promise<AISubscriptionLoginPollResult>;
    cancelLogin: (
      entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
      attemptId: string
    ) => Promise<AISubscriptionEntry[]>;
    disconnect: (entryId: AISubscriptionEntryId) => Promise<AISubscriptionEntry[]>;
    getCapabilityRoutes: (capabilityId: CapabilityId) => Promise<AISubscriptionCapabilityRoute[]>;
    refreshStatus: (entryId: AISubscriptionEntryId) => Promise<AISubscriptionEntry[]>;
  };
  shell: {
    openExternalUrl: (url: string) => Promise<{ ok: true }>;
  };
  db: {
    getProjects: () => Promise<Project[]>;
    createProject: (name: string, projectPath: string, scene?: ProjectScene) => Promise<Project>;
    deleteProject: (id: string) => Promise<void>;
    renameProject: (id: string, name: string) => Promise<{ id: string; name: string; updated_at: number }>;
    getSessions: (projectId: string) => Promise<Session[]>;
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => Promise<Session>;
    deleteSession: (sessionId: string) => Promise<void>;
    getMessages: (sessionId: string) => Promise<Message[]>;
    saveMessage: (message: any) => Promise<Message>;
    updateMessageThinkDuration: (id: string, seconds: number) => Promise<void>;
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
    getProjectSkillOverrides: (projectId: string) => Promise<Record<string, SkillOverrideState>>;
    setProjectSkillOverride: (projectId: string, skillName: string, visibility: SkillOverrideState) => Promise<Record<string, SkillOverrideState>>;
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
    judge: (payload: { projectId: string; agentId?: string | null; prompt: string; overrides?: ChatRuntimeOverrides }) => Promise<{ text: string }>;
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
    runWorkflow: (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>, approvalMode?: string) => Promise<string>;
    stopWorkflow: (executionId: string) => Promise<void>;
    getWorkflowEvents: (executionId: string) => Promise<WorkflowStreamEvent[]>;
    onWorkflowEvent: (executionId: string, callback: (event: any, data: WorkflowStreamEvent) => void) => () => void;
    // 历史执行记录
    listExecutions: (workflowId: string) => Promise<WorkflowExecution[]>;
    deleteExecution: (executionId: string) => Promise<void>;
    exportExecution: (executionId: string) => Promise<{ saved: boolean; path?: string; canceled?: boolean; error?: string }>;
    // Phase 14: HITL 审批
    resolveApproval: (executionId: string, approvalId: string, resolution: WorkflowApprovalResolution) => Promise<void>;
    onExecutionStarted: (callback: (data: { executionId: string; workflowId: string; triggerSource: string }) => void) => () => void;
  };
  // ===== File Management =====
  fs: {
    readDirectory: (rootPath: string, dirPath: string, showHidden?: boolean) => Promise<{ ok: true; data: DirectoryEntry[] } | { ok: false; error: FileError }>;
    readFile: (rootPath: string, filePath: string) => Promise<{ ok: true; data: FileContent | BinaryFileInfo } | { ok: false; error: FileError }>;
    getFileInfo: (rootPath: string, filePath: string) => Promise<{ ok: true; data: FileInfo } | { ok: false; error: FileError }>;
    onDirectoryChange: (callback: (event: any, data: { type: string; path: string }) => void) => () => void;
    writeFile: (rootPath: string, filePath: string, content: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    createFile: (rootPath: string, filePath: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    createDirectory: (rootPath: string, dirPath: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    renameEntry: (rootPath: string, oldPath: string, newName: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    trashEntry: (rootPath: string, targetPath: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    showItemInFolder: (filePath: string) => Promise<{ ok: true }>;
    watchDirectory: (rootPath: string, dirPath: string) => Promise<{ ok: true } | { ok: false; error: FileError }>;
    unwatchDirectory: (dirPath: string) => Promise<{ ok: true }>;
  };
  // ===== Phase 6 Plan 02: Slash Command Registry Bridge (D-15) =====
  commands: {
    list: (projectId: string, agentId: string) => Promise<{
      commands: SlashCommand[];
      conflicts: CommandConflictError[];
      warnings: Array<{ type: 'mcp_health_warning'; message: string }>;
    }>;
    readProjectCommands: (projectId: string) => Promise<{ commands: SlashCommand[] }>;
    readBody: (bodyPath: string) => Promise<{ body: string; mtimeMs: number }>;
    readSkillBody: (projectId: string, agentId: string | null | undefined, skillPath: string) => Promise<{ body: string; mtimeMs: number }>;
    onChanged: (callback: (event: any, data: { source: string }) => void) => () => void;
    // Phase 8 — D-16: chokidar fallback notification bridge
    onFallback: (
      callback: (event: any, data: { scope: 'system' | 'project'; dir: string; error: string }) => void
    ) => () => void;
  };
  // ===== Phase 08.3 Plan 01: @Mention file candidate bridge (E-05) =====
  project: {
    listAtMentionCandidates: (projectId: string) => Promise<AtMentionCandidateList>;
  };
  knowledge: {
    list: (projectId: string, options?: KnowledgeEntrySearchOptions) => Promise<KnowledgeEntrySummary[]>;
    search: (projectId: string, options?: KnowledgeEntrySearchOptions) => Promise<KnowledgeEntrySummary[]>;
    create: (projectId: string, input: KnowledgeEntryCreateInput) => Promise<KnowledgeEntrySummary>;
    read: (projectId: string, relativePath: string) => Promise<KnowledgeEntrySummary>;
    update: (projectId: string, relativePath: string, input: KnowledgeEntryUpdateInput) => Promise<KnowledgeEntrySummary>;
    delete: (projectId: string, relativePath: string) => Promise<{ deleted: true }>;
  };
  papers: {
    openPdf: (projectId: string, resource: string) => Promise<{ success: boolean }>;
  };
  paperSearch: {
    getSettings: () => Promise<PaperSearchConfigSettings>;
    saveConfigValue: (key: PaperSearchConfigKey, value: string) => Promise<PaperSearchConfigSettings>;
    clearConfigValue: (key: PaperSearchConfigKey) => Promise<PaperSearchConfigSettings>;
  };
  // ===== Phase 7 Plan 01: /context token breakdown (D-08) =====
  context: {
    currentSession: (sessionId: string, contextLimit?: number, overriddenModelName?: string) => Promise<ContextAggregate>;
  };
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
