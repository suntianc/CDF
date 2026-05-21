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
    selectDirectory: () => ipcRenderer.invoke('db:selectDirectory'),
  },
  platform: process.platform,
});
