import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

const piWorkbenchAPI = {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

  // Workspace
  workspaceList: () => ipcRenderer.invoke('workspace:list'),
  workspaceAdd: (path: string) => ipcRenderer.invoke('workspace:add', path),
  workspaceSwitch: (path: string) => ipcRenderer.invoke('workspace:switch', path),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // Theme
  themeGet: () => ipcRenderer.invoke('theme:get'),
  themeSet: (theme: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', theme),

  // Providers
  providersList: () => ipcRenderer.invoke('providers:list'),
  providersSave: (provider: Record<string, unknown>) => ipcRenderer.invoke('providers:save', provider),
  providersDelete: (id: string) => ipcRenderer.invoke('providers:delete', id),
  providersTest: (provider: Record<string, unknown>) => ipcRenderer.invoke('providers:test', provider),

  // Window
  windowStateSave: (state: Record<string, unknown>) => ipcRenderer.invoke('window:stateSave', state)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronAPI', piWorkbenchAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.electronAPI = piWorkbenchAPI
}