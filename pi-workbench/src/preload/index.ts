import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api: Record<string, any> = {}

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
  windowStateSave: (state: Record<string, unknown>) => ipcRenderer.invoke('window:stateSave', state),

  // ── Session APIs (Phase 2) ──
  sessionCreate: (cwd: string) => ipcRenderer.invoke('session:create', cwd),
  sessionList: (cwd: string) => ipcRenderer.invoke('session:list', cwd),
  sessionOpen: (path: string) => ipcRenderer.invoke('session:open', path),
  sessionSendMessage: (data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }) =>
    ipcRenderer.invoke('session:sendMessage', data),
  sessionSetName: (sessionPath: string, name: string) => ipcRenderer.invoke('session:setName', { sessionPath, name }),
  sessionDelete: (sessionPath: string) => ipcRenderer.invoke('session:delete', sessionPath),
  sessionStartStream: (sessionPath: string) => ipcRenderer.send('session:startStream', { sessionPath }),
  sessionStopStream: (sessionPath: string) => ipcRenderer.send('session:stopStream', { sessionPath }),
  sessionOnStreamChunk: (callback: (chunk: any) => void) => {
    const handler = (_event: any, chunk: any) => callback(chunk)
    ipcRenderer.on('session:streamChunk', handler)
    return () => ipcRenderer.removeListener('session:streamChunk', handler)
  },

  // ── GSD APIs (Phase 2) ──
  gsdExecute: (command: string, args: string[], cwd?: string) =>
    ipcRenderer.invoke('gsd:execute', { command, args, cwd }),
  gsdListCommands: () => ipcRenderer.invoke('gsd:listCommands')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', {
  ...api,
  // Session APIs
  session: {
    create: (cwd: string) => ipcRenderer.invoke('session:create', cwd),
    list: (cwd: string) => ipcRenderer.invoke('session:list', cwd),
    open: (path: string) => ipcRenderer.invoke('session:open', path),
    sendMessage: (data: { sessionPath: string; content: string; images?: Array<{ data: string; mimeType: string }> }) =>
      ipcRenderer.invoke('session:sendMessage', data),
    setName: (sessionPath: string, name: string) => ipcRenderer.invoke('session:setName', { sessionPath, name }),
    delete: (sessionPath: string) => ipcRenderer.invoke('session:delete', sessionPath),
    startStream: (sessionPath: string) => ipcRenderer.send('session:startStream', { sessionPath }),
    stopStream: (sessionPath: string) => ipcRenderer.send('session:stopStream', { sessionPath }),
    onStreamChunk: (callback: (chunk: any) => void) => {
      const handler = (_event: any, chunk: any) => callback(chunk)
      ipcRenderer.on('session:streamChunk', handler)
      return () => ipcRenderer.removeListener('session:streamChunk', handler)
    }
  },
  // GSD APIs
  gsd: {
    execute: (command: string, args: string[], cwd?: string) =>
      ipcRenderer.invoke('gsd:execute', { command, args, cwd }),
    listCommands: () => ipcRenderer.invoke('gsd:listCommands')
  }
})
    contextBridge.exposeInMainWorld('electronAPI', piWorkbenchAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = {
    ...api,
    session: {
      create: (cwd: string) => ipcRenderer.invoke('session:create', cwd),
      list: (cwd: string) => ipcRenderer.invoke('session:list', cwd),
      open: (path: string) => ipcRenderer.invoke('session:open', path),
      sendMessage: (data: any) => ipcRenderer.invoke('session:sendMessage', data),
      setName: (sessionPath: string, name: string) => ipcRenderer.invoke('session:setName', { sessionPath, name }),
      delete: (sessionPath: string) => ipcRenderer.invoke('session:delete', sessionPath),
      startStream: (sessionPath: string) => ipcRenderer.send('session:startStream', { sessionPath }),
      stopStream: (sessionPath: string) => ipcRenderer.send('session:stopStream', { sessionPath }),
      onStreamChunk: (callback: (chunk: any) => void) => {
        const handler = (_event: any, chunk: any) => callback(chunk)
        ipcRenderer.on('session:streamChunk', handler)
        return () => ipcRenderer.removeListener('session:streamChunk', handler)
      }
    },
    gsd: {
      execute: (command: string, args: string[], cwd?: string) =>
        ipcRenderer.invoke('gsd:execute', { command, args, cwd }),
      listCommands: () => ipcRenderer.invoke('gsd:listCommands')
    }
  }
  // @ts-ignore (define in dts)
  window.electronAPI = piWorkbenchAPI
}