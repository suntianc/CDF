// IPC channel contract — 单一契约表：channel 名 → 请求参数元组 + 响应类型。
// preload 侧 typedInvoke 与主进程侧 typedHandle 均从这张表推导类型；
// 参数保持位置元组形态（与线上 invoke 形态一致），以 handler 实际消费为真。
// 纯类型层契约：不做运行时校验，运行时行为不变。
import type {
  Agent,
  AgentRun,
  AgentSaveInput,
  AgentSaveResult,
  AgentToolCall,
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntrySummary,
  KnowledgeEntryUpdateInput,
  LLMProvider,
  LLMProviderSaveInput,
  LLMProviderSaveResult,
  MCPServer,
  MCPServerSaveInput,
  MCPServerSaveResult,
  Message,
  MessageSaveInput,
  Project,
  ProjectScene,
  SearchProvider,
  SearchProviderSaveInput,
  SearchProviderSaveResult,
  Session,
  Skill,
  SkillSaveInput,
  Workflow,
  WorkflowExecution,
  WorkflowNodeRun,
  WorkflowSaveInput,
} from './types';
import type { SkillOverrideState } from './skill-overrides';

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
  // 物理 Skill 文件系统下无版本表；参数保留线上形态，handler 忽略并恒返回空数组。
  'db:getSkillVersions': { args: [skillId: string]; result: never[] };
  'db:getAgentRuns': { args: [sessionId: string]; result: AgentRun[] };
  'db:getAgentToolCalls': { args: [runId: string]; result: AgentToolCall[] };
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
  'db:getWorkflowExecutions': { args: [workflowId: string]; result: WorkflowExecution[] };
  'db:getWorkflowExecution': { args: [id: string]; result: WorkflowExecution | undefined };
  'db:getWorkflowNodeRuns': { args: [executionId: string]; result: WorkflowNodeRun[] };
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
  'db:getAgents',
  'db:saveAgent',
  'db:deleteAgent',
  'db:getSkills',
  'db:getProjectSkillOverrides',
  'db:setProjectSkillOverride',
  'db:saveSkill',
  'db:deleteSkill',
  'db:importSkillDirectory',
  'db:getSkillVersions',
  'db:getAgentRuns',
  'db:getAgentToolCalls',
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
  'db:getWorkflowExecutions',
  'db:getWorkflowExecution',
  'db:getWorkflowNodeRuns',
  'db:openFile',
  'db:revealFile',
  'knowledge:list',
  'knowledge:search',
  'knowledge:create',
  'knowledge:read',
  'knowledge:update',
  'knowledge:delete',
  'paper-library:openPdf',
] as const satisfies readonly IpcInvokeChannel[];

type AssertNever<T extends never> = T;
type MissingInvokeChannels = Exclude<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]>;
// 契约新增 channel 却没有加进 IPC_INVOKE_CHANNELS 时，这里编译报错。
export type _AllInvokeChannelsListed = AssertNever<MissingInvokeChannels>;

// ===== 静态事件通道（main → renderer）：channel 名 → payload =====
// 各域迁移时填充（fs / commands / workflow）。
export interface IpcEventContract {}

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C];

// ===== 动态模板通道（main → renderer，按 id 拼名）=====
// 通道名字符串携带 payload 类型，发送侧与监听侧共用同一工厂，不再手拼模板。
export type DynamicIpcChannel<P> = string & { readonly __ipcEventPayload?: P };

export function dynamicIpcChannel<P>(prefix: string): (id: string) => DynamicIpcChannel<P> {
  return (id) => `${prefix}${id}` as DynamicIpcChannel<P>;
}

export type DynamicIpcPayload<C> = C extends DynamicIpcChannel<infer P> ? P : never;
