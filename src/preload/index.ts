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
    createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string) =>
      ipcRenderer.invoke('db:createSession', projectId, name, parentSessionId, summary),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('db:deleteSession', sessionId),
    getMessages: (sessionId: string) => ipcRenderer.invoke('db:getMessages', sessionId),
    saveMessage: (message: any) => ipcRenderer.invoke('db:saveMessage', message),
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
    getSkillVersions: (skillId: string) => ipcRenderer.invoke('db:getSkillVersions', skillId),
    // Phase 3: MCP Servers
    getMcpServers: () => ipcRenderer.invoke('db:getMcpServers'),
    saveMcpServer: (server: any) => ipcRenderer.invoke('db:saveMcpServer', server),
    deleteMcpServer: (id: string) => ipcRenderer.invoke('db:deleteMcpServer', id),
    toggleMcpConnection: (id: string, connected: boolean) => ipcRenderer.invoke('db:toggleMcpConnection', id, connected),
    checkMcpHealth: (id: string) => ipcRenderer.invoke('db:checkMcpHealth', id),
    selectFile: () => ipcRenderer.invoke('db:selectFile'),
  },
  llm: {
    chat: (requestId: string, payload: any) => ipcRenderer.invoke('llm:chat', requestId, payload),
    stopChat: (requestId: string) => ipcRenderer.invoke('llm:stopChat', requestId),
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
  platform: process.platform,
});
