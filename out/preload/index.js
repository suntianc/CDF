"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  store: {
    get: (key) => electron.ipcRenderer.invoke("store:get", key),
    set: (key, value) => electron.ipcRenderer.invoke("store:set", key, value)
  },
  db: {
    getProjects: () => electron.ipcRenderer.invoke("db:getProjects"),
    createProject: (name, projectPath) => electron.ipcRenderer.invoke("db:createProject", name, projectPath),
    deleteProject: (id) => electron.ipcRenderer.invoke("db:deleteProject", id),
    getSessions: (projectId) => electron.ipcRenderer.invoke("db:getSessions", projectId),
    createSession: (projectId, name, parentSessionId, summary) => electron.ipcRenderer.invoke("db:createSession", projectId, name, parentSessionId, summary),
    deleteSession: (sessionId) => electron.ipcRenderer.invoke("db:deleteSession", sessionId),
    getMessages: (sessionId) => electron.ipcRenderer.invoke("db:getMessages", sessionId),
    saveMessage: (message) => electron.ipcRenderer.invoke("db:saveMessage", message),
    getProviders: () => electron.ipcRenderer.invoke("db:getProviders"),
    saveProvider: (provider) => electron.ipcRenderer.invoke("db:saveProvider", provider),
    deleteProvider: (id) => electron.ipcRenderer.invoke("db:deleteProvider", id),
    setActiveProvider: (id) => electron.ipcRenderer.invoke("db:setActiveProvider", id),
    selectDirectory: () => electron.ipcRenderer.invoke("db:selectDirectory"),
    // Phase 3: Agent Library
    getAgents: () => electron.ipcRenderer.invoke("db:getAgents"),
    saveAgent: (agent) => electron.ipcRenderer.invoke("db:saveAgent", agent),
    deleteAgent: (id) => electron.ipcRenderer.invoke("db:deleteAgent", id),
    // Phase 3: Skills
    getSkills: () => electron.ipcRenderer.invoke("db:getSkills"),
    saveSkill: (skill) => electron.ipcRenderer.invoke("db:saveSkill", skill),
    deleteSkill: (id) => electron.ipcRenderer.invoke("db:deleteSkill", id),
    getSkillVersions: (skillId) => electron.ipcRenderer.invoke("db:getSkillVersions", skillId),
    // Phase 3: MCP Servers
    getMcpServers: () => electron.ipcRenderer.invoke("db:getMcpServers"),
    saveMcpServer: (server) => electron.ipcRenderer.invoke("db:saveMcpServer", server),
    deleteMcpServer: (id) => electron.ipcRenderer.invoke("db:deleteMcpServer", id),
    toggleMcpConnection: (id, connected) => electron.ipcRenderer.invoke("db:toggleMcpConnection", id, connected),
    checkMcpHealth: (id) => electron.ipcRenderer.invoke("db:checkMcpHealth", id)
  },
  llm: {
    chat: (requestId, payload) => electron.ipcRenderer.invoke("llm:chat", requestId, payload),
    fetchOllamaModels: (apiUrl) => electron.ipcRenderer.invoke("llm:fetchOllamaModels", apiUrl),
    onChunk: (requestId, callback) => {
      const channel = `llm:chunk-${requestId}`;
      const listener = (event, data) => callback(event, data);
      electron.ipcRenderer.on(channel, listener);
      return () => {
        electron.ipcRenderer.removeListener(channel, listener);
      };
    }
  },
  deepagents: {
    createAgent: (config) => electron.ipcRenderer.invoke("deepagents:createAgent", config)
  },
  platform: process.platform
});
