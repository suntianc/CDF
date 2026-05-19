import { ipcMain, dialog } from 'electron'
import store from './store'

export function registerIpcHandlers(): void {
  // Store operations
  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key as any)
  })
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key as any, value)
    return true
  })
  ipcMain.handle('store:delete', (_event, key: string) => {
    store.delete(key as any)
    return true
  })

  // Folder dialog
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Workspace operations
  ipcMain.handle('workspace:list', () => {
    return store.get('workspaces', [])
  })
  ipcMain.handle('workspace:add', (_event, workspacePath: string) => {
    const workspaces = store.get('workspaces', [])
    const existing = workspaces.find(w => w.path === workspacePath)
    if (!existing) {
      workspaces.push({
        path: workspacePath,
        name: workspacePath.split('/').pop() || workspacePath,
        lastOpened: new Date().toISOString()
      })
      store.set('workspaces', workspaces)
    } else {
      existing.lastOpened = new Date().toISOString()
      store.set('workspaces', workspaces)
    }
    return store.get('workspaces')
  })
  ipcMain.handle('workspace:switch', (_event, workspacePath: string) => {
    const workspaces = store.get('workspaces', [])
    const ws = workspaces.find(w => w.path === workspacePath)
    if (ws) ws.lastOpened = new Date().toISOString()
    store.set('workspaces', workspaces)
    store.set('lastWorkspace', workspacePath)
    return workspacePath
  })

  // Theme operations
  ipcMain.handle('theme:get', () => store.get('theme', 'system'))
  ipcMain.handle('theme:set', (_event, theme: 'light' | 'dark' | 'system') => {
    store.set('theme', theme)
    return true
  })

  // Provider operations
  ipcMain.handle('providers:list', () => store.get('providers', []))
  ipcMain.handle('providers:save', (_event, provider: Record<string, unknown>) => {
    const providers = store.get('providers', [])
    const idx = providers.findIndex(p => p.id === provider.id)
    if (idx >= 0) {
      providers[idx] = provider as typeof providers[0]
    } else {
      providers.push(provider as typeof providers[0])
    }
    store.set('providers', providers)
    return true
  })
  ipcMain.handle('providers:delete', (_event, providerId: string) => {
    const providers = store.get('providers', [])
    store.set('providers', providers.filter(p => p.id !== providerId))
    return true
  })
  ipcMain.handle('providers:test', async (_event, _provider: Record<string, unknown>) => {
    // Stub for Phase 1 — returns success/failure simulation
    return { success: true, message: 'Connection test stub' }
  })

  // Window state
  ipcMain.handle('window:stateSave', (_event, state: Record<string, unknown>) => {
    store.set('windowState', state)
    return true
  })
}