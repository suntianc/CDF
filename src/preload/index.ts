import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { typedInvoke } from './typed-ipc';
import { llmChunkChannel, parallelTaskStepChannel } from '../shared/ipc-contract';
import type { IpcEventPayload } from '../shared/ipc-contract';
import type {
  AgentApprovalResolution,
  AgentSaveInput,
  ChatPayload,
  JudgePayload,
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntryUpdateInput,
  LLMProviderSaveInput,
  MCPServerSaveInput,
  LLMStreamEvent,
  MessageSaveInput,
  PaperSearchConfigKey,
  ParallelTaskStepEvent,
  ProjectScene,
  SearchProviderSaveInput,
  SkillSaveInput,
  WorkflowSaveInput,
  StageGateResolution,
  WorkflowRunProjectionEvent,
} from '../shared/types';
import type { SkillOverrideState } from '../shared/skill-overrides';
import type { AISubscriptionEntryId, CapabilityId } from '../shared/ai-subscriptions';
import type { CapabilityJobAction } from '../shared/capability-jobs';

const api = {
  store: {
    get: (key: string) => typedInvoke('store:get', key),
    set: (key: string, value: unknown) => typedInvoke('store:set', key, value),
  },
  aiSubscriptions: {
    getEntries: () => typedInvoke('aiSubscriptions:getEntries'),
    getActiveLogins: () => typedInvoke('aiSubscriptions:getActiveLogins'),
    setCapabilityEnabled: (entryId: AISubscriptionEntryId, capabilityId: CapabilityId, enabled: boolean) =>
      typedInvoke('aiSubscriptions:setCapabilityEnabled', entryId, capabilityId, enabled),
    connectWithKey: (entryId: AISubscriptionEntryId, subscriptionKey: string) =>
      typedInvoke('aiSubscriptions:connectWithKey', entryId, subscriptionKey),
    startLogin: (entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>) =>
      typedInvoke('aiSubscriptions:startLogin', entryId),
    pollLogin: (entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>, attemptId: string) =>
      typedInvoke('aiSubscriptions:pollLogin', entryId, attemptId),
    cancelLogin: (entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>, attemptId: string) =>
      typedInvoke('aiSubscriptions:cancelLogin', entryId, attemptId),
    disconnect: (entryId: AISubscriptionEntryId) =>
      typedInvoke('aiSubscriptions:disconnect', entryId),
    getCapabilityRoutes: (capabilityId: CapabilityId) =>
      typedInvoke('aiSubscriptions:getCapabilityRoutes', capabilityId),
    refreshStatus: (entryId: AISubscriptionEntryId) =>
      typedInvoke('aiSubscriptions:refreshStatus', entryId),
  },
  shell: {
    openExternalUrl: (url: string) => typedInvoke('shell:openExternalUrl', url),
  },
  db: {
    getProjects: () => typedInvoke('db:getProjects'),
    createProject: (name: string, projectPath: string, scene?: ProjectScene) =>
      typedInvoke('db:createProject', name, projectPath, scene),
    deleteProject: (id: string) => typedInvoke('db:deleteProject', id),
    renameProject: (id: string, name: string) => typedInvoke('db:renameProject', id, name),
    getSessions: (projectId: string) => typedInvoke('db:getSessions', projectId),
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) =>
      typedInvoke('db:createSession', projectId, name, parentSessionId, summary, agentId),
    deleteSession: (sessionId: string) => typedInvoke('db:deleteSession', sessionId),
    getMessages: (sessionId: string) => typedInvoke('db:getMessages', sessionId),
    saveMessage: (message: MessageSaveInput) => typedInvoke('db:saveMessage', message),
    updateMessageThinkDuration: (id: string, seconds: number) => typedInvoke('db:updateMessageThinkDuration', id, seconds),
    deleteMessage: (id: string) => typedInvoke('db:deleteMessage', id),
    getProviders: () => typedInvoke('db:getProviders'),
    saveProvider: (provider: LLMProviderSaveInput) => typedInvoke('db:saveProvider', provider),
    deleteProvider: (id: string) => typedInvoke('db:deleteProvider', id),
    setActiveProvider: (id: string) => typedInvoke('db:setActiveProvider', id),
    selectDirectory: () => typedInvoke('db:selectDirectory'),
    // Phase 3: Agent Library
    getAgents: (projectId: string) => typedInvoke('db:getAgents', projectId),
    saveAgent: (agent: AgentSaveInput) => typedInvoke('db:saveAgent', agent),
    deleteAgent: (id: string) => typedInvoke('db:deleteAgent', id),
    // Phase 3: Skills
    getSkills: (projectId: string) => typedInvoke('db:getSkills', projectId),
    getProjectSkillOverrides: (projectId: string) => typedInvoke('db:getProjectSkillOverrides', projectId),
    setProjectSkillOverride: (projectId: string, skillName: string, visibility: SkillOverrideState) =>
      typedInvoke('db:setProjectSkillOverride', projectId, skillName, visibility),
    saveSkill: (projectId: string, skill: SkillSaveInput) => typedInvoke('db:saveSkill', projectId, skill),
    deleteSkill: (projectId: string, id: string) => typedInvoke('db:deleteSkill', projectId, id),
    importSkillDirectory: (sourceDir: string) => typedInvoke('db:importSkillDirectory', sourceDir),
    getAgentRuns: (sessionId: string) => typedInvoke('db:getAgentRuns', sessionId),
    getAgentToolCalls: (runId: string) => typedInvoke('db:getAgentToolCalls', runId),
    getLatestTodos: (sessionId: string) => typedInvoke('db:getLatestTodos', sessionId),
    // Phase 3: MCP Servers
    getMcpServers: () => typedInvoke('db:getMcpServers'),
    saveMcpServer: (server: MCPServerSaveInput) => typedInvoke('db:saveMcpServer', server),
    deleteMcpServer: (id: string) => typedInvoke('db:deleteMcpServer', id),
    toggleMcpConnection: (id: string, connected: boolean) => typedInvoke('db:toggleMcpConnection', id, connected),
    checkMcpHealth: (id: string) => typedInvoke('db:checkMcpHealth', id),
    selectFile: () => typedInvoke('db:selectFile'),
    // Phase 4: Tool Configs
    getToolConfigs: () => typedInvoke('db:getToolConfigs'),
    saveToolConfig: (config: SearchProviderSaveInput) => typedInvoke('db:saveToolConfig', config),
    deleteToolConfig: (id: string) => typedInvoke('db:deleteToolConfig', id),
    // Phase 4: Workflows
    getWorkflows: (projectId: string) => typedInvoke('db:getWorkflows', projectId),
    getWorkflow: (id: string) => typedInvoke('db:getWorkflow', id),
    saveWorkflow: (workflow: WorkflowSaveInput) => typedInvoke('db:saveWorkflow', workflow),
    deleteWorkflow: (id: string) => typedInvoke('db:deleteWorkflow', id),
    openFile: (filePath: string, projectId?: string) => typedInvoke('db:openFile', filePath, projectId),
    revealFile: (filePath: string, projectId?: string) => typedInvoke('db:revealFile', filePath, projectId),
  },
  llm: {
    chat: (requestId: string, payload: ChatPayload) => typedInvoke('llm:chat', requestId, payload),
    judge: (payload: JudgePayload) => typedInvoke('llm:judge', payload),
    stopChat: (requestId: string) => typedInvoke('llm:stopChat', requestId),
    resolveApproval: (requestId: string, resolution: AgentApprovalResolution) => typedInvoke('llm:resolveApproval', requestId, resolution),
    testProvider: (providerId: string) => typedInvoke('llm:testProvider', providerId),
    fetchProviderModels: (providerId: string) => typedInvoke('llm:fetchProviderModels', providerId),
    fetchOllamaModels: (apiUrl: string) => typedInvoke('llm:fetchOllamaModels', apiUrl),
    onChunk: (requestId: string, callback: (event: IpcRendererEvent, data: LLMStreamEvent) => void) => {
      const channel = llmChunkChannel(requestId);
      const listener = (event: IpcRendererEvent, data: LLMStreamEvent) => callback(event, data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    }
  },
  deepagents: {
    createAgent: (config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }) =>
      typedInvoke('deepagents:createAgent', config),
    onParallelTaskStep: (sessionId: string, callback: (event: IpcRendererEvent, data: ParallelTaskStepEvent) => void) => {
      const channel = parallelTaskStepChannel(sessionId);
      const listener = (event: IpcRendererEvent, data: ParallelTaskStepEvent) => callback(event, data);
      ipcRenderer.on(channel, listener);
      return () => { ipcRenderer.removeListener(channel, listener); };
    },
  },
  // ===== File Management =====
  fs: {
    readDirectory: (rootPath: string, dirPath: string, showHidden?: boolean) =>
      typedInvoke('fs:readDirectory', rootPath, dirPath, showHidden),
    readFile: (rootPath: string, filePath: string) =>
      typedInvoke('fs:readFile', rootPath, filePath),
    getFileInfo: (rootPath: string, filePath: string) =>
      typedInvoke('fs:getFileInfo', rootPath, filePath),
    onDirectoryChange: (callback: (event: IpcRendererEvent, data: IpcEventPayload<'fs:directoryChange'>) => void) => {
      const listener = (event: IpcRendererEvent, data: IpcEventPayload<'fs:directoryChange'>) => callback(event, data);
      ipcRenderer.on('fs:directoryChange', listener);
      return () => { ipcRenderer.removeListener('fs:directoryChange', listener); };
    },
    writeFile: (rootPath: string, filePath: string, content: string) =>
      typedInvoke('fs:writeFile', rootPath, filePath, content),
    createFile: (rootPath: string, filePath: string) =>
      typedInvoke('fs:createFile', rootPath, filePath),
    createDirectory: (rootPath: string, dirPath: string) =>
      typedInvoke('fs:createDirectory', rootPath, dirPath),
    renameEntry: (rootPath: string, oldPath: string, newName: string) =>
      typedInvoke('fs:renameEntry', rootPath, oldPath, newName),
    trashEntry: (rootPath: string, targetPath: string) =>
      typedInvoke('fs:trashEntry', rootPath, targetPath),
    showItemInFolder: (filePath: string) =>
      typedInvoke('fs:showItemInFolder', filePath),
    watchDirectory: (rootPath: string, dirPath: string) =>
      typedInvoke('fs:watchDirectory', rootPath, dirPath),
    unwatchDirectory: (dirPath: string) =>
      typedInvoke('fs:unwatchDirectory', dirPath),
  },
  // ===== Phase 6 Plan 02: Slash Command Registry bridge =====
  commands: {
    list: (projectId: string, agentId: string) =>
      typedInvoke('commands:list', projectId, agentId),
    readProjectCommands: (projectId: string) =>
      typedInvoke('commands:readProjectCommands', projectId),
    // 08.2 D-06: lazy body load on dispatch. Returns body + mtime; defensive
    // empty values on path-traversal/missing-file/IO failure.
    readBody: (bodyPath: string) =>
      typedInvoke('commands:readBody', bodyPath),
    readSkillBody: (projectId: string, agentId: string | null | undefined, skillPath: string) =>
      typedInvoke('commands:readSkillBody', projectId, agentId, skillPath),
    onChanged: (callback: (event: IpcRendererEvent, data: IpcEventPayload<'commands:changed'>) => void) => {
      const listener = (event: IpcRendererEvent, data: IpcEventPayload<'commands:changed'>) => callback(event, data);
      ipcRenderer.on('commands:changed', listener);
      return () => {
        ipcRenderer.removeListener('commands:changed', listener);
      };
    },
    // Phase 8 — D-16: chokidar fallback notification. Fired once per session
    // when chokidar.watch() fails (EPERM/ENOENT/EBUSY). Renderer shows a
    // user-visible toast and re-fetches the (now static) command list.
    onFallback: (callback: (event: IpcRendererEvent, data: IpcEventPayload<'commands:fallback'>) => void) => {
      const listener = (event: IpcRendererEvent, data: IpcEventPayload<'commands:fallback'>) => callback(event, data);
      ipcRenderer.on('commands:fallback', listener);
      return () => {
        ipcRenderer.removeListener('commands:fallback', listener);
      };
    },
  },
  workflowRun: {
    start: (workflowId: string, projectId: string) =>
      typedInvoke('workflow-run:start', workflowId, projectId),
    getRuns: (workflowId: string) =>
      typedInvoke('workflow-run:get-runs', workflowId),
    getRun: (runId: string) =>
      typedInvoke('workflow-run:get-run', runId),
    getRunBySession: (sessionId: string) =>
      typedInvoke('workflow-run:get-run-by-session', sessionId),
    getStageGates: (runId: string) =>
      typedInvoke('workflow-run:get-stage-gates', runId),
    resolveStageGate: (gateId: string, resolution: StageGateResolution) =>
      typedInvoke('workflow-run:resolve-stage-gate', gateId, resolution),
    abort: (runId: string) =>
      typedInvoke('workflow-run:abort', runId),
    getTasks: (runId: string) =>
      typedInvoke('workflow-run:get-tasks', runId),
    onProjectionEvent: (callback: (data: WorkflowRunProjectionEvent) => void) => {
      const listener = (_event: IpcRendererEvent, data: WorkflowRunProjectionEvent) => callback(data);
      ipcRenderer.on('workflow-run:projection-event', listener);
      return () => { ipcRenderer.removeListener('workflow-run:projection-event', listener); };
    },
  },
  conversation: {
    getActiveRun: (sessionId: string) => typedInvoke('conversation:get-active-run', sessionId),
    onRunEvent: (
      callback: (data: IpcEventPayload<'conversation:run-event'>) => void
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        data: IpcEventPayload<'conversation:run-event'>
      ) => callback(data);
      ipcRenderer.on('conversation:run-event', listener);
      return () => {
        ipcRenderer.removeListener('conversation:run-event', listener);
      };
    },
    onMessagesChanged: (
      callback: (data: IpcEventPayload<'conversation:messages-changed'>) => void
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        data: IpcEventPayload<'conversation:messages-changed'>
      ) => callback(data);
      ipcRenderer.on('conversation:messages-changed', listener);
      return () => {
        ipcRenderer.removeListener('conversation:messages-changed', listener);
      };
    },
  },
  capabilityJobs: {
    list: (projectId: string) => typedInvoke('capability-jobs:list', projectId),
    command: (projectId: string, jobId: string, action: CapabilityJobAction) =>
      typedInvoke('capability-jobs:command', projectId, jobId, action),
    onChanged: (callback: (data: IpcEventPayload<'capability-jobs:changed'>) => void) => {
      const listener = (_event: IpcRendererEvent, data: IpcEventPayload<'capability-jobs:changed'>) =>
        callback(data);
      ipcRenderer.on('capability-jobs:changed', listener);
      return () => {
        ipcRenderer.removeListener('capability-jobs:changed', listener);
      };
    },
  },
  // ===== Phase 08.3 Plan 01: @Mention file candidate bridge (E-01, E-05) =====
  // Returns relative POSIX paths (directories suffixed with `/`). Renderer
  // infers `kind` from `path.endsWith('/')` (pitfall #4 — minimal payload).
  project: {
    listAtMentionCandidates: (projectId: string) =>
      typedInvoke('project:listAtMentionCandidates', projectId),
  },
  knowledge: {
    list: (projectId: string, options?: KnowledgeEntrySearchOptions) =>
      typedInvoke('knowledge:list', projectId, options),
    search: (projectId: string, options?: KnowledgeEntrySearchOptions) =>
      typedInvoke('knowledge:search', projectId, options),
    create: (projectId: string, input: KnowledgeEntryCreateInput) =>
      typedInvoke('knowledge:create', projectId, input),
    read: (projectId: string, relativePath: string) =>
      typedInvoke('knowledge:read', projectId, relativePath),
    update: (projectId: string, relativePath: string, input: KnowledgeEntryUpdateInput) =>
      typedInvoke('knowledge:update', projectId, relativePath, input),
    delete: (projectId: string, relativePath: string) =>
      typedInvoke('knowledge:delete', projectId, relativePath),
  },
  papers: {
    openPdf: (projectId: string, resource: string) =>
      typedInvoke('paper-library:openPdf', projectId, resource),
  },
  paperSearch: {
    getSettings: () => typedInvoke('paper-search:getSettings'),
    saveConfigValue: (key: PaperSearchConfigKey, value: string) =>
      typedInvoke('paper-search:saveConfigValue', key, value),
    clearConfigValue: (key: PaperSearchConfigKey) =>
      typedInvoke('paper-search:clearConfigValue', key),
  },
  // ===== Phase 7 Plan 01: /context token breakdown bridge (D-08) =====
  // 08.2 P4: optional contextLimit so renderer can pin the active provider
  // limit (P10 mitigation). Falls back to default 200_000 server-side.
  context: {
    currentSession: (sessionId: string, contextLimit?: number, overriddenModelName?: string) =>
      typedInvoke('context:currentSession', sessionId, contextLimit, overriddenModelName),
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);

// window.electronAPI 的类型即实际暴露对象：契约 → preload → window，结构性漂移不可能存在。
export type PreloadApi = typeof api;
