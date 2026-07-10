import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { typedInvoke } from './typed-ipc';
import { llmChunkChannel, parallelTaskStepChannel, workflowEventChannel } from '../shared/ipc-contract';
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
  ApprovalMode,
  WorkflowApprovalResolution,
  WorkflowStreamEvent,
  WorkflowTriggerSource,
} from '../shared/types';
import type { SkillOverrideState } from '../shared/skill-overrides';

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  aiSubscriptions: {
    getEntries: () => ipcRenderer.invoke('aiSubscriptions:getEntries'),
    getActiveLogins: () => ipcRenderer.invoke('aiSubscriptions:getActiveLogins'),
    setCapabilityEnabled: (entryId: string, capabilityId: string, enabled: boolean) =>
      ipcRenderer.invoke('aiSubscriptions:setCapabilityEnabled', entryId, capabilityId, enabled),
    connectWithKey: (entryId: string, subscriptionKey: string) =>
      ipcRenderer.invoke('aiSubscriptions:connectWithKey', entryId, subscriptionKey),
    startLogin: (entryId: string) =>
      ipcRenderer.invoke('aiSubscriptions:startLogin', entryId),
    pollLogin: (entryId: string, attemptId: string) =>
      ipcRenderer.invoke('aiSubscriptions:pollLogin', entryId, attemptId),
    cancelLogin: (entryId: string, attemptId: string) =>
      ipcRenderer.invoke('aiSubscriptions:cancelLogin', entryId, attemptId),
    disconnect: (entryId: string) =>
      ipcRenderer.invoke('aiSubscriptions:disconnect', entryId),
    getCapabilityRoutes: (capabilityId: string) =>
      ipcRenderer.invoke('aiSubscriptions:getCapabilityRoutes', capabilityId),
    refreshStatus: (entryId: string) =>
      ipcRenderer.invoke('aiSubscriptions:refreshStatus', entryId),
  },
  shell: {
    openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternalUrl', url),
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
    getSkillVersions: (skillId: string) => typedInvoke('db:getSkillVersions', skillId),
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
    getWorkflowExecutions: (workflowId: string) => typedInvoke('db:getWorkflowExecutions', workflowId),
    getWorkflowExecution: (id: string) => typedInvoke('db:getWorkflowExecution', id),
    getWorkflowNodeRuns: (executionId: string) => typedInvoke('db:getWorkflowNodeRuns', executionId),
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
  workflow: {
    runWorkflow: (workflowId: string, projectId: string, triggerSource: WorkflowTriggerSource, input?: Record<string, unknown>, approvalMode?: ApprovalMode) =>
      typedInvoke('workflow:run', workflowId, projectId, triggerSource, input, approvalMode),
    stopWorkflow: (executionId: string) =>
      typedInvoke('workflow:stop', executionId),
    getWorkflowEvents: (executionId: string) =>
      typedInvoke('workflow:getEvents', executionId),
    onWorkflowEvent: (executionId: string, callback: (event: IpcRendererEvent, data: WorkflowStreamEvent) => void) => {
      const channel = workflowEventChannel(executionId);
      const listener = (event: IpcRendererEvent, data: WorkflowStreamEvent) => callback(event, data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
    // 历史执行记录
    listExecutions: (workflowId: string) =>
      typedInvoke('workflow:listExecutions', workflowId),
    deleteExecution: (executionId: string) =>
      typedInvoke('workflow:deleteExecution', executionId),
    exportExecution: (executionId: string) =>
      typedInvoke('workflow:exportExecution', executionId),
    // Phase 14: HITL 审批
    resolveApproval: (executionId: string, approvalId: string, resolution: WorkflowApprovalResolution) =>
      typedInvoke('workflow:approve', executionId, approvalId, resolution),
    onExecutionStarted: (callback: (data: IpcEventPayload<'workflow:execution-started'>) => void) => {
      const listener = (_event: IpcRendererEvent, data: IpcEventPayload<'workflow:execution-started'>) => callback(data);
      ipcRenderer.on('workflow:execution-started', listener);
      return () => { ipcRenderer.removeListener('workflow:execution-started', listener); };
    },
  },
  // ===== File Management =====
  fs: {
    readDirectory: (rootPath: string, dirPath: string, showHidden?: boolean) =>
      ipcRenderer.invoke('fs:readDirectory', rootPath, dirPath, showHidden),
    readFile: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke('fs:readFile', rootPath, filePath),
    getFileInfo: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke('fs:getFileInfo', rootPath, filePath),
    onDirectoryChange: (callback: (event: any, data: { type: string; path: string }) => void) => {
      const listener = (event: any, data: { type: string; path: string }) => callback(event, data);
      ipcRenderer.on('fs:directoryChange', listener);
      return () => { ipcRenderer.removeListener('fs:directoryChange', listener); };
    },
    writeFile: (rootPath: string, filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', rootPath, filePath, content),
    createFile: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke('fs:createFile', rootPath, filePath),
    createDirectory: (rootPath: string, dirPath: string) =>
      ipcRenderer.invoke('fs:createDirectory', rootPath, dirPath),
    renameEntry: (rootPath: string, oldPath: string, newName: string) =>
      ipcRenderer.invoke('fs:renameEntry', rootPath, oldPath, newName),
    trashEntry: (rootPath: string, targetPath: string) =>
      ipcRenderer.invoke('fs:trashEntry', rootPath, targetPath),
    showItemInFolder: (filePath: string) =>
      ipcRenderer.invoke('fs:showItemInFolder', filePath),
    watchDirectory: (rootPath: string, dirPath: string) =>
      ipcRenderer.invoke('fs:watchDirectory', rootPath, dirPath),
    unwatchDirectory: (dirPath: string) =>
      ipcRenderer.invoke('fs:unwatchDirectory', dirPath),
  },
  // ===== Phase 6 Plan 02: Slash Command Registry bridge =====
  commands: {
    list: (projectId: string, agentId: string) =>
      ipcRenderer.invoke('commands:list', projectId, agentId),
    readProjectCommands: (projectId: string) =>
      ipcRenderer.invoke('commands:readProjectCommands', projectId),
    // 08.2 D-06: lazy body load on dispatch. Returns body + mtime; defensive
    // empty values on path-traversal/missing-file/IO failure.
    readBody: (bodyPath: string): Promise<{ body: string; mtimeMs: number }> =>
      ipcRenderer.invoke('commands:readBody', bodyPath),
    readSkillBody: (projectId: string, agentId: string | null | undefined, skillPath: string): Promise<{ body: string; mtimeMs: number }> =>
      ipcRenderer.invoke('commands:readSkillBody', projectId, agentId, skillPath),
    onChanged: (callback: (event: any, data: { source: string }) => void) => {
      const listener = (event: any, data: { source: string }) => callback(event, data);
      ipcRenderer.on('commands:changed', listener);
      return () => {
        ipcRenderer.removeListener('commands:changed', listener);
      };
    },
    // Phase 8 — D-16: chokidar fallback notification. Fired once per session
    // when chokidar.watch() fails (EPERM/ENOENT/EBUSY). Renderer shows a
    // user-visible toast and re-fetches the (now static) command list.
    onFallback: (callback: (event: any, data: { scope: 'system' | 'project'; dir: string; error: string }) => void) => {
      const listener = (event: any, data: { scope: 'system' | 'project'; dir: string; error: string }) => callback(event, data);
      ipcRenderer.on('commands:fallback', listener);
      return () => {
        ipcRenderer.removeListener('commands:fallback', listener);
      };
    },
  },
  // ===== Phase 08.3 Plan 01: @Mention file candidate bridge (E-01, E-05) =====
  // Returns relative POSIX paths (directories suffixed with `/`). Renderer
  // infers `kind` from `path.endsWith('/')` (pitfall #4 — minimal payload).
  project: {
    listAtMentionCandidates: (projectId: string) =>
      ipcRenderer.invoke('project:listAtMentionCandidates', projectId),
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
    getSettings: () => ipcRenderer.invoke('paper-search:getSettings'),
    saveConfigValue: (key: PaperSearchConfigKey, value: string) =>
      ipcRenderer.invoke('paper-search:saveConfigValue', key, value),
    clearConfigValue: (key: PaperSearchConfigKey) =>
      ipcRenderer.invoke('paper-search:clearConfigValue', key),
  },
  // ===== Phase 7 Plan 01: /context token breakdown bridge (D-08) =====
  // 08.2 P4: optional contextLimit so renderer can pin the active provider
  // limit (P10 mitigation). Falls back to default 200_000 server-side.
  context: {
    currentSession: (sessionId: string, contextLimit?: number, overriddenModelName?: string) =>
      ipcRenderer.invoke('context:currentSession', sessionId, contextLimit, overriddenModelName),
  },
  platform: process.platform,
});
