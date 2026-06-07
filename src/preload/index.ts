import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  },
  db: {
    getProjects: () => ipcRenderer.invoke('db:getProjects'),
    createProject: (name: string, projectPath: string) =>
      ipcRenderer.invoke('db:createProject', name, projectPath),
    deleteProject: (id: string) => ipcRenderer.invoke('db:deleteProject', id),
    renameProject: (id: string, name: string) => ipcRenderer.invoke('db:renameProject', id, name),
    getSessions: (projectId: string) => ipcRenderer.invoke('db:getSessions', projectId),
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) =>
      ipcRenderer.invoke('db:createSession', projectId, name, parentSessionId, summary, agentId),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('db:deleteSession', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
    saveMessage: (message: any) => ipcRenderer.invoke('db:saveMessage', message),
    deleteMessage: (id: string) => ipcRenderer.invoke('db:deleteMessage', id),
    getProviders: () => ipcRenderer.invoke('db:getProviders'),
    saveProvider: (provider: any) => ipcRenderer.invoke('db:saveProvider', provider),
    deleteProvider: (id: string) => ipcRenderer.invoke('db:deleteProvider', id),
    setActiveProvider: (id: string) => ipcRenderer.invoke('db:setActiveProvider', id),
    selectDirectory: () => ipcRenderer.invoke('db:selectDirectory'),
    // Phase 3: Agent Library
    getAgents: (projectId: string) => ipcRenderer.invoke('db:getAgents', projectId),
    saveAgent: (agent: any) => ipcRenderer.invoke('db:saveAgent', agent),
    deleteAgent: (id: string) => ipcRenderer.invoke('db:deleteAgent', id),
    // Phase 3: Skills
    getSkills: (projectId: string) => ipcRenderer.invoke('db:getSkills', projectId),
    saveSkill: (projectId: string, skill: any) => ipcRenderer.invoke('db:saveSkill', projectId, skill),
    deleteSkill: (projectId: string, id: string) => ipcRenderer.invoke('db:deleteSkill', projectId, id),
    importSkillDirectory: (sourceDir: string) => ipcRenderer.invoke('db:importSkillDirectory', sourceDir),
    getSkillVersions: (skillId: string) => ipcRenderer.invoke('db:getSkillVersions', skillId),
    getAgentRuns: (sessionId: string) => ipcRenderer.invoke('db:getAgentRuns', sessionId),
    getAgentToolCalls: (runId: string) => ipcRenderer.invoke('db:getAgentToolCalls', runId),
    getLatestTodos: (sessionId: string) => ipcRenderer.invoke('db:getLatestTodos', sessionId),
    // Phase 3: MCP Servers
    getMcpServers: () => ipcRenderer.invoke('db:getMcpServers'),
    saveMcpServer: (server: any) => ipcRenderer.invoke('db:saveMcpServer', server),
    deleteMcpServer: (id: string) => ipcRenderer.invoke('db:deleteMcpServer', id),
    toggleMcpConnection: (id: string, connected: boolean) => ipcRenderer.invoke('db:toggleMcpConnection', id, connected),
    checkMcpHealth: (id: string) => ipcRenderer.invoke('db:checkMcpHealth', id),
    selectFile: () => ipcRenderer.invoke('db:selectFile'),
    // Phase 4: Tool Configs
    getToolConfigs: () => ipcRenderer.invoke('db:getToolConfigs'),
    saveToolConfig: (config: any) => ipcRenderer.invoke('db:saveToolConfig', config),
    deleteToolConfig: (id: string) => ipcRenderer.invoke('db:deleteToolConfig', id),
    // Phase 4: Workflows
    getWorkflows: (projectId: string) => ipcRenderer.invoke('db:getWorkflows', projectId),
    getWorkflow: (id: string) => ipcRenderer.invoke('db:getWorkflow', id),
    saveWorkflow: (workflow: any) => ipcRenderer.invoke('db:saveWorkflow', workflow),
    deleteWorkflow: (id: string) => ipcRenderer.invoke('db:deleteWorkflow', id),
    getWorkflowExecutions: (workflowId: string) => ipcRenderer.invoke('db:getWorkflowExecutions', workflowId),
    getWorkflowExecution: (id: string) => ipcRenderer.invoke('db:getWorkflowExecution', id),
    getWorkflowNodeRuns: (executionId: string) => ipcRenderer.invoke('db:getWorkflowNodeRuns', executionId),
    openFile: (filePath: string, projectId?: string) => ipcRenderer.invoke('db:openFile', filePath, projectId),
    revealFile: (filePath: string, projectId?: string) => ipcRenderer.invoke('db:revealFile', filePath, projectId),
  },
  llm: {
    chat: (requestId: string, payload: any) => ipcRenderer.invoke('llm:chat', requestId, payload),
    judge: (payload: any) => ipcRenderer.invoke('llm:judge', payload),
    stopChat: (requestId: string) => ipcRenderer.invoke('llm:stopChat', requestId),
    resolveApproval: (requestId: string, resolution: any) => ipcRenderer.invoke('llm:resolveApproval', requestId, resolution),
    testProvider: (providerId: string) => ipcRenderer.invoke('llm:testProvider', providerId),
    fetchProviderModels: (providerId: string) => ipcRenderer.invoke('llm:fetchProviderModels', providerId),
    fetchOllamaModels: (apiUrl: string) => ipcRenderer.invoke('llm:fetchOllamaModels', apiUrl),
    onChunk: (requestId: string, callback: (event: any, data: any) => void) => {
      const channel = `llm:chunk-${requestId}`;
      const listener = (event: any, data: any) => callback(event, data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    }
  },
  deepagents: {
    createAgent: (config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }) =>
      ipcRenderer.invoke('deepagents:createAgent', config),
  },
  workflow: {
    runWorkflow: (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) =>
      ipcRenderer.invoke('workflow:run', workflowId, projectId, triggerSource, input),
    stopWorkflow: (executionId: string) =>
      ipcRenderer.invoke('workflow:stop', executionId),
    getWorkflowEvents: (executionId: string) =>
      ipcRenderer.invoke('workflow:getEvents', executionId),
    onWorkflowEvent: (executionId: string, callback: (event: any, data: any) => void) => {
      const channel = `workflow:event-${executionId}`;
      const listener = (event: any, data: any) => callback(event, data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
    // 历史执行记录
    listExecutions: (workflowId: string) =>
      ipcRenderer.invoke('workflow:listExecutions', workflowId),
    deleteExecution: (executionId: string) =>
      ipcRenderer.invoke('workflow:deleteExecution', executionId),
    exportExecution: (executionId: string) =>
      ipcRenderer.invoke('workflow:exportExecution', executionId),
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
  // ===== Phase 7 Plan 01: /context token breakdown bridge (D-08) =====
  // 08.2 P4: optional contextLimit so renderer can pin the active provider
  // limit (P10 mitigation). Falls back to default 200_000 server-side.
  context: {
    currentSession: (sessionId: string, contextLimit?: number) =>
      ipcRenderer.invoke('context:currentSession', sessionId, contextLimit),
  },
  platform: process.platform,
});
