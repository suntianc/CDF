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
    selectDirectory: () => electron.ipcRenderer.invoke("db:selectDirectory")
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
  platform: process.platform
});
