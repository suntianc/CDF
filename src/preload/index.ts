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
    getAgents: () => ipcRenderer.invoke('db:getAgents'),
    saveAgent: (agent: any) => ipcRenderer.invoke('db:saveAgent', agent),
    deleteAgent: (id: string) => ipcRenderer.invoke('db:deleteAgent', id),
    // Phase 3: Skills
    getSkills: () => ipcRenderer.invoke('db:getSkills'),
    saveSkill: (skill: any) => ipcRenderer.invoke('db:saveSkill', skill),
    deleteSkill: (id: string) => ipcRenderer.invoke('db:deleteSkill', id),
    getSkillVersions: (skillId: string) => ipcRenderer.invoke('db:getSkillVersions', skillId),
    // Phase 3: MCP Servers
    getMcpServers: () => ipcRenderer.invoke('db:getMcpServers'),
    saveMcpServer: (server: any) => ipcRenderer.invoke('db:saveMcpServer', server),
    deleteMcpServer: (id: string) => ipcRenderer.invoke('db:deleteMcpServer', id),
    toggleMcpConnection: (id: string, connected: boolean) => ipcRenderer.invoke('db:toggleMcpConnection', id, connected),
    checkMcpHealth: (id: string) => ipcRenderer.invoke('db:checkMcpHealth', id),
  },
  llm: {
    chat: (requestId: string, payload: any) => ipcRenderer.invoke('llm:chat', requestId, payload),
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
