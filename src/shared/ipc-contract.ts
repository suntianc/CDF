// IPC channel contract — 单一契约表：channel 名 → 请求参数元组 + 响应类型。
// preload 侧 typedInvoke 与主进程侧 typedHandle 均从这张表推导类型；
// 参数保持位置元组形态（与线上 invoke 形态一致），以 handler 实际消费为真。
// 纯类型层契约：不做运行时校验，运行时行为不变。
import type { Agent, AgentSaveInput, AgentSaveResult } from './agents';
import type {
  AgentApprovalResolution,
  AgentRun,
  AgentToolCall,
  DelegatedAgentRun,
  ParallelTaskStepEvent,
} from './agent-runtime';
import type { AtMentionCandidateList } from './at-mention';
import type { SlashCommand, CommandConflictError } from './commands';
import type {
  ChatPayload,
  ConversationRunStreamEnvelope,
  ConversationRunStreamSnapshot,
  JudgePayload,
  LLMStreamEvent,
  Message,
  MessageSaveInput,
  Session,
} from './conversations';
import type { ContextAggregate } from './context';
import type { BinaryFileInfo, DirectoryEntry, FileContent, FileError, FileInfo } from './filesystem';
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntrySummary,
  KnowledgeEntryUpdateInput,
  PaperSearchConfigKey,
  PaperSearchConfigSettings,
} from './knowledge';
import type { Project, ProjectScene } from './projects';
import type {
  LLMProvider,
  LLMProviderSaveInput,
  LLMProviderSaveResult,
  MCPServer,
  MCPServerSaveInput,
  MCPServerSaveResult,
  SearchProvider,
  SearchProviderSaveInput,
  SearchProviderSaveResult,
} from './providers';
import type { Skill, SkillSaveInput } from './skills';
import type {
  StageGateResolution,
  Workflow,
  WorkflowRun,
  WorkflowRunProjectionEvent,
  WorkflowRunTask,
  WorkflowSaveInput,
  WorkflowStage,
  WorkflowStageGate,
} from './workflows';
import type {
  CapabilityJobAction,
  CapabilityJobCommandResult,
  CapabilityJobEvent,
  CapabilityJobSnapshot,
} from './capability-jobs';
import type { SkillOverrideState } from './skill-overrides';
import type {
  AISubscriptionCapabilityRoute,
  AISubscriptionEntry,
  AISubscriptionEntryId,
  AISubscriptionLoginPollResult,
  AISubscriptionLoginStartResult,
  CapabilityId,
} from './ai-subscriptions';

// OAuth 登录仅支持的订阅入口子集。
type OAuthAISubscriptionEntryId = Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>;

// electron-store 桥的值域：JSON 可序列化值。
// 不能写成裸 unknown —— 契约中任何 result: unknown 的条目都会成为 typedHandle
// 泛型反推的 match-all 候选，破坏所有调用点的字面量收窄（实测 TS 6.0）。
export type StoreJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | StoreJsonValue[]
  | { [key: string]: StoreJsonValue };

// fs 域 handler 的统一返回形态：成功回执 / 带数据成功 / 失败带 FileError。
type FsAck = { ok: true } | { ok: false; error: FileError };
type FsData<T> = { ok: true; data: T } | { ok: false; error: FileError };

export interface IpcInvokeContract {
  // ===== db：Projects / Sessions / Messages / LLM Providers =====
  'db:getProjects': { args: []; result: Project[] };
  'db:createProject': {
    args: [name: string, projectPath: string, scene?: ProjectScene];
    result: Project;
  };
  'db:deleteProject': { args: [id: string]; result: void };
  'db:renameProject': {
    args: [id: string, name: string];
    result: { id: string; name: string; updated_at: number };
  };
  'db:getSessions': { args: [projectId: string]; result: Session[] };
  'db:createSession': {
    args: [projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string];
    result: Session;
  };
  'db:deleteSession': { args: [sessionId: string]; result: void };
  'db:getMessages': { args: [sessionId: string]; result: Message[] };
  'db:saveMessage': { args: [message: MessageSaveInput]; result: Message };
  'db:updateMessageThinkDuration': { args: [id: string, seconds: number]; result: void };
  'db:deleteMessage': { args: [id: string]; result: void };
  'db:getProviders': { args: []; result: LLMProvider[] };
  'db:saveProvider': { args: [provider: LLMProviderSaveInput]; result: LLMProviderSaveResult };
  'db:deleteProvider': { args: [id: string]; result: void };
  'db:setActiveProvider': { args: [id: string]; result: void };
  'db:selectDirectory': { args: []; result: string | null };
  'capability-jobs:list': { args: [projectId: string]; result: CapabilityJobSnapshot[] };
  'capability-jobs:command': {
    args: [projectId: string, jobId: string, action: CapabilityJobAction];
    result: CapabilityJobCommandResult;
  };
  'conversation:get-active-run': {
    args: [sessionId: string];
    result: ConversationRunStreamSnapshot | null;
  };
  // ===== db：Agent 库 / Skills / MCP / Tool Configs / Workflow 存储 =====
  'db:getAgents': { args: [projectId: string]; result: Agent[] };
  'db:saveAgent': { args: [agent: AgentSaveInput]; result: AgentSaveResult };
  'db:deleteAgent': { args: [id: string]; result: void };
  'db:getSkills': { args: [projectId: string]; result: Skill[] };
  'db:getProjectSkillOverrides': {
    args: [projectId: string];
    result: Record<string, SkillOverrideState>;
  };
  'db:setProjectSkillOverride': {
    args: [projectId: string, skillName: string, visibility: SkillOverrideState];
    result: Record<string, SkillOverrideState>;
  };
  'db:saveSkill': { args: [projectId: string, skill: SkillSaveInput]; result: Skill };
  'db:deleteSkill': { args: [projectId: string, id: string]; result: void };
  'db:importSkillDirectory': { args: [sourceDir: string]; result: Skill };
  'db:getAgentRuns': { args: [sessionId: string]; result: AgentRun[] };
  'db:getAgentToolCalls': { args: [runId: string]; result: AgentToolCall[] };
  'db:getDelegatedAgentRuns': { args: [sessionId: string]; result: DelegatedAgentRun[] };
  'db:getLatestTodos': { args: [sessionId: string]; result: AgentToolCall | undefined };
  'db:getMcpServers': { args: []; result: MCPServer[] };
  'db:saveMcpServer': { args: [server: MCPServerSaveInput]; result: MCPServerSaveResult };
  'db:deleteMcpServer': { args: [id: string]; result: void };
  'db:toggleMcpConnection': { args: [id: string, connected: boolean]; result: void };
  'db:checkMcpHealth': { args: [id: string]; result: { ok: boolean; message?: string } };
  'db:selectFile': {
    args: [];
    result: { name: string; script_type: 'bash' | 'python' | 'javascript'; content: string } | null;
  };
  'db:getToolConfigs': { args: []; result: SearchProvider[] };
  'db:saveToolConfig': {
    args: [config: SearchProviderSaveInput];
    result: SearchProviderSaveResult;
  };
  'db:deleteToolConfig': { args: [id: string]; result: void };
  'db:getWorkflows': { args: [projectId: string]; result: Workflow[] };
  'db:getWorkflow': { args: [id: string]; result: Workflow | undefined };
  'db:saveWorkflow': { args: [workflow: WorkflowSaveInput]; result: Workflow };
  'db:deleteWorkflow': { args: [id: string]; result: void };
  'db:openFile': {
    args: [filePath: string, projectId?: string];
    result: { success: boolean; error?: string };
  };
  'db:revealFile': {
    args: [filePath: string, projectId?: string];
    result: { success: boolean; error?: string; warning?: string };
  };
  // ===== Knowledge Base / Paper Library =====
  'knowledge:list': {
    args: [projectId: string, options?: KnowledgeEntrySearchOptions];
    result: KnowledgeEntrySummary[];
  };
  'knowledge:search': {
    args: [projectId: string, options?: KnowledgeEntrySearchOptions];
    result: KnowledgeEntrySummary[];
  };
  'knowledge:create': {
    args: [projectId: string, input: KnowledgeEntryCreateInput];
    result: KnowledgeEntrySummary;
  };
  'knowledge:read': {
    args: [projectId: string, relativePath: string];
    result: KnowledgeEntrySummary;
  };
  'knowledge:update': {
    args: [projectId: string, relativePath: string, input: KnowledgeEntryUpdateInput];
    result: KnowledgeEntrySummary;
  };
  'knowledge:delete': {
    args: [projectId: string, relativePath: string];
    result: { deleted: true };
  };
  'paper-library:openPdf': {
    args: [projectId: string, resource: string];
    result: { success: true };
  };
  // ===== LLM 会话 / Provider 探测 =====
  // fire-and-forget：handler 立即返回 { ok: true }，流式结果走 llm:chunk-* 动态通道。
  'llm:chat': { args: [requestId: string, payload: ChatPayload]; result: { ok: true } };
  'llm:judge': { args: [payload: JudgePayload]; result: { text: string } };
  'llm:stopChat': { args: [requestId: string]; result: void };
  'llm:resolveApproval': {
    args: [requestId: string, resolution: AgentApprovalResolution];
    result: void;
  };
  'llm:testProvider': { args: [providerId: string]; result: { ok: boolean; message: string } };
  'llm:fetchProviderModels': { args: [providerId: string]; result: string[] };
  'llm:fetchOllamaModels': { args: [apiUrl: string]; result: string[] };
  // ===== deepagents =====
  'deepagents:createAgent': {
    args: [config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }];
    result: { agentId: string };
  };
  // ===== 文件管理 =====
  'fs:readDirectory': {
    args: [rootPath: string, dirPath: string, showHidden?: boolean];
    result: FsData<DirectoryEntry[]>;
  };
  'fs:readFile': {
    args: [rootPath: string, filePath: string];
    result: FsData<FileContent | BinaryFileInfo>;
  };
  'fs:getFileInfo': { args: [rootPath: string, filePath: string]; result: FsData<FileInfo> };
  'fs:writeFile': { args: [rootPath: string, filePath: string, content: string]; result: FsAck };
  'fs:createFile': { args: [rootPath: string, filePath: string]; result: FsAck };
  'fs:createDirectory': { args: [rootPath: string, dirPath: string]; result: FsAck };
  'fs:renameEntry': { args: [rootPath: string, oldPath: string, newName: string]; result: FsAck };
  'fs:trashEntry': { args: [rootPath: string, targetPath: string]; result: FsAck };
  'fs:showItemInFolder': { args: [filePath: string]; result: { ok: true } };
  'fs:watchDirectory': { args: [rootPath: string, dirPath: string]; result: FsAck };
  'fs:unwatchDirectory': { args: [dirPath: string]; result: { ok: true } };
  // ===== Slash Command Registry 桥 =====
  'commands:list': {
    args: [projectId: string, agentId: string];
    result: {
      commands: SlashCommand[];
      conflicts: CommandConflictError[];
      warnings: Array<{ type: 'mcp_health_warning'; message: string }>;
    };
  };
  'commands:readProjectCommands': {
    args: [projectId: string];
    result: { commands: SlashCommand[] };
  };
  'commands:readBody': { args: [bodyPath: string]; result: { body: string; mtimeMs: number } };
  'commands:readSkillBody': {
    args: [projectId: string, agentId: string | null | undefined, skillPath: string];
    result: { body: string; mtimeMs: number };
  };
  // ===== shell / electron-store =====
  'shell:openExternalUrl': { args: [url: string]; result: { ok: true } };
  // 通用 kv 桥：值形态由各调用方约定，契约层如实标注 unknown。
  'store:get': { args: [key: string]; result: StoreJsonValue };
  'store:set': { args: [key: string, value: unknown]; result: void };
  // ===== AI Subscription Surface =====
  'aiSubscriptions:getEntries': { args: []; result: AISubscriptionEntry[] };
  'aiSubscriptions:getActiveLogins': {
    args: [];
    result: Partial<Record<OAuthAISubscriptionEntryId, AISubscriptionLoginStartResult['descriptor']>>;
  };
  'aiSubscriptions:setCapabilityEnabled': {
    args: [entryId: AISubscriptionEntryId, capabilityId: CapabilityId, enabled: boolean];
    result: AISubscriptionEntry[];
  };
  'aiSubscriptions:connectWithKey': {
    args: [entryId: AISubscriptionEntryId, subscriptionKey: string];
    result: AISubscriptionEntry[];
  };
  'aiSubscriptions:startLogin': {
    args: [entryId: OAuthAISubscriptionEntryId];
    result: AISubscriptionLoginStartResult;
  };
  'aiSubscriptions:pollLogin': {
    args: [entryId: OAuthAISubscriptionEntryId, attemptId: string];
    result: AISubscriptionLoginPollResult;
  };
  'aiSubscriptions:cancelLogin': {
    args: [entryId: OAuthAISubscriptionEntryId, attemptId: string];
    result: AISubscriptionEntry[];
  };
  'aiSubscriptions:disconnect': { args: [entryId: AISubscriptionEntryId]; result: AISubscriptionEntry[] };
  'aiSubscriptions:getCapabilityRoutes': {
    args: [capabilityId: CapabilityId];
    result: AISubscriptionCapabilityRoute[];
  };
  'aiSubscriptions:refreshStatus': { args: [entryId: AISubscriptionEntryId]; result: AISubscriptionEntry[] };
  // ===== @Mention 候选 =====
  'project:listAtMentionCandidates': { args: [projectId: string]; result: AtMentionCandidateList };
  // ===== Paper Search 配置 =====
  'paper-search:getSettings': { args: []; result: PaperSearchConfigSettings };
  'paper-search:saveConfigValue': {
    args: [key: PaperSearchConfigKey, value: string];
    result: PaperSearchConfigSettings;
  };
  'paper-search:clearConfigValue': {
    args: [key: PaperSearchConfigKey];
    result: PaperSearchConfigSettings;
  };
  // ===== /context token 统计 =====
  'context:currentSession': {
    args: [sessionId: string, contextLimit?: number, overriddenModelName?: string];
    result: ContextAggregate;
  };
  // ===== Phase 14+: C-lite Workflow Run =====
  'workflow-run:start': {
    args: [workflowId: string, projectId: string];
    result: { runId: string; sessionId: string; firstStage: WorkflowStage };
  };
  'workflow-run:get-runs': { args: [workflowId: string]; result: WorkflowRun[] };
  'workflow-run:get-run': { args: [runId: string]; result: WorkflowRun | undefined };
  'workflow-run:get-run-by-session': { args: [sessionId: string]; result: WorkflowRun | null };
  'workflow-run:get-stage-gates': { args: [runId: string]; result: WorkflowStageGate[] };
  'workflow-run:resolve-stage-gate': { args: [gateId: string, resolution: StageGateResolution]; result: void };
  'workflow-run:abort': { args: [runId: string]; result: void };
  'workflow-run:get-tasks': { args: [runId: string, stageId?: string]; result: WorkflowRunTask[] };
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C]['args'];
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeContract[C]['result'];

// 契约 channel 的运行时清单，供注册完整性测试使用。
// satisfies 保证清单里只有合法 channel；下方 AssertNever 保证契约里没有漏列的 channel。
export const IPC_INVOKE_CHANNELS = [
  'db:getProjects',
  'db:createProject',
  'db:deleteProject',
  'db:renameProject',
  'db:getSessions',
  'db:createSession',
  'db:deleteSession',
  'db:getMessages',
  'db:saveMessage',
  'db:updateMessageThinkDuration',
  'db:deleteMessage',
  'db:getProviders',
  'db:saveProvider',
  'db:deleteProvider',
  'db:setActiveProvider',
  'db:selectDirectory',
  'capability-jobs:list',
  'capability-jobs:command',
  'conversation:get-active-run',
  'db:getAgents',
  'db:saveAgent',
  'db:deleteAgent',
  'db:getSkills',
  'db:getProjectSkillOverrides',
  'db:setProjectSkillOverride',
  'db:saveSkill',
  'db:deleteSkill',
  'db:importSkillDirectory',
  'db:getAgentRuns',
  'db:getAgentToolCalls',
  'db:getDelegatedAgentRuns',
  'db:getLatestTodos',
  'db:getMcpServers',
  'db:saveMcpServer',
  'db:deleteMcpServer',
  'db:toggleMcpConnection',
  'db:checkMcpHealth',
  'db:selectFile',
  'db:getToolConfigs',
  'db:saveToolConfig',
  'db:deleteToolConfig',
  'db:getWorkflows',
  'db:getWorkflow',
  'db:saveWorkflow',
  'db:deleteWorkflow',
  'db:openFile',
  'db:revealFile',
  'knowledge:list',
  'knowledge:search',
  'knowledge:create',
  'knowledge:read',
  'knowledge:update',
  'knowledge:delete',
  'paper-library:openPdf',
  'llm:chat',
  'llm:judge',
  'llm:stopChat',
  'llm:resolveApproval',
  'llm:testProvider',
  'llm:fetchProviderModels',
  'llm:fetchOllamaModels',
  'deepagents:createAgent',
  'workflow-run:start',
  'workflow-run:get-runs',
  'workflow-run:get-run',
  'workflow-run:get-run-by-session',
  'workflow-run:get-stage-gates',
  'workflow-run:resolve-stage-gate',
  'workflow-run:abort',
  'workflow-run:get-tasks',
  'fs:readDirectory',
  'fs:readFile',
  'fs:getFileInfo',
  'fs:writeFile',
  'fs:createFile',
  'fs:createDirectory',
  'fs:renameEntry',
  'fs:trashEntry',
  'fs:showItemInFolder',
  'fs:watchDirectory',
  'fs:unwatchDirectory',
  'commands:list',
  'commands:readProjectCommands',
  'commands:readBody',
  'commands:readSkillBody',
  'shell:openExternalUrl',
  'store:get',
  'store:set',
  'aiSubscriptions:getEntries',
  'aiSubscriptions:getActiveLogins',
  'aiSubscriptions:setCapabilityEnabled',
  'aiSubscriptions:connectWithKey',
  'aiSubscriptions:startLogin',
  'aiSubscriptions:pollLogin',
  'aiSubscriptions:cancelLogin',
  'aiSubscriptions:disconnect',
  'aiSubscriptions:getCapabilityRoutes',
  'aiSubscriptions:refreshStatus',
  'project:listAtMentionCandidates',
  'paper-search:getSettings',
  'paper-search:saveConfigValue',
  'paper-search:clearConfigValue',
  'context:currentSession',
] as const satisfies readonly IpcInvokeChannel[];

type AssertNever<T extends never> = T;
type MissingInvokeChannels = Exclude<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]>;
// 契约新增 channel 却没有加进 IPC_INVOKE_CHANNELS 时，这里编译报错。
export type _AllInvokeChannelsListed = AssertNever<MissingInvokeChannels>;

// ===== 静态事件通道（main → renderer）：channel 名 → payload =====
export interface IpcEventContract {
  'conversation:messages-changed': { sessionId: string };
  'conversation:run-event': ConversationRunStreamEnvelope;
  'fs:directoryChange': { type: string; path: string };
  'commands:changed': { source: string };
  'commands:fallback': { scope: 'system' | 'project'; dir: string; error: string };
  'capability-jobs:changed': CapabilityJobEvent;
  'workflow-run:projection-event': WorkflowRunProjectionEvent;
}

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];

// ===== 动态模板通道（main → renderer，按 id 拼名）=====
// 通道名字符串携带 payload 类型，发送侧与监听侧共用同一工厂，不再手拼模板。
export type DynamicIpcChannel<P> = string & { readonly __ipcEventPayload?: P };

export function dynamicIpcChannel<P>(prefix: string): (id: string) => DynamicIpcChannel<P> {
  return (id) => `${prefix}${id}` as DynamicIpcChannel<P>;
}

export type DynamicIpcPayload<C> = C extends DynamicIpcChannel<infer P> ? P : never;

// LLM 流式 chunk：主进程发送侧与 preload 监听侧共用（按 requestId 拼名）。
export const llmChunkChannel = dynamicIpcChannel<LLMStreamEvent>('llm:chunk-');

// 并行任务步进：主进程发送侧与 preload 监听侧共用（按 sessionId 拼名）。
export const parallelTaskStepChannel = dynamicIpcChannel<ParallelTaskStepEvent>('agent:parallel-task-step-');
