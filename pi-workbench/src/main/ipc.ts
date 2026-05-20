import { ipcMain, dialog, BrowserWindow } from 'electron'
import store from './store'

// Active streaming sessions — keyed by session path
const activeStreams = new Map<string, AbortController>()

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

  // ── Session IPC Channels (Phase 2) ──

  ipcMain.handle('session:create', async (_event, cwd: string) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const session = SessionManager.create(cwd)
    return { id: session.getSessionId(), path: session.getSessionFile() }
  })

  ipcMain.handle('session:list', async (_event, cwd: string) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessions = await SessionManager.list(cwd)
    return sessions.map(s => ({
      id: s.id,
      name: s.name || '',
      createdAt: s.created.toISOString(),
      messageCount: s.messageCount
    }))
  })

  ipcMain.handle('session:open', async (_event, path: string) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const session = SessionManager.open(path)
    const context = session.buildSessionContext()
    return {
      id: session.getSessionId(),
      name: session.getSessionName(),
      path: session.getSessionFile(),
      messages: context.messages,
      settings: {}
    }
  })

  ipcMain.handle('session:sendMessage', async (_event, { sessionPath, content, images }) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const session = SessionManager.open(sessionPath)

    const messageContent = images
      ? [{ type: 'text', text: content } as const, ...images.map(img => ({ type: 'image', data: img.data, mimeType: img.mimeType }))]
      : content

    const entryId = session.appendMessage({ role: 'user', content: messageContent })

    return { entryId, sessionId: session.getSessionId() }
  })

  ipcMain.handle('session:setName', async (_event, { sessionPath, name }: { sessionPath: string; name: string }) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const session = SessionManager.open(sessionPath)
    session.appendSessionInfo(name)
    return { success: true }
  })

  ipcMain.handle('session:delete', async (_event, sessionPath: string) => {
    const fs = await import('fs/promises')
    await fs.unlink(sessionPath)
    return { success: true }
  })

  // ── Streaming Event Channels (Phase 2) ──

  ipcMain.on('session:startStream', async (event, { sessionPath }: { sessionPath: string }) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const session = SessionManager.open(sessionPath)
    const browserWindow = BrowserWindow.fromWebContents(event.sender)

    const controller = new AbortController()
    activeStreams.set(sessionPath, controller)

    try {
      const context = session.buildSessionContext()

      // Use pi SDK agent to generate streaming response
      // NOTE: agent setup refined in Plan 03 — this is the streaming foundation
      const stream = await (await import('@earendil-works/pi-coding-agent')).AgentSession.generateStream?.(context.messages, context.settings) as AsyncIterable<any> | undefined

      if (stream) {
        for await (const chunk of stream) {
          if (controller.signal.aborted) break
          if (browserWindow && !browserWindow.isDestroyed()) {
            event.sender.send('session:streamChunk', {
              type: chunk.type || 'text',
              content: chunk.content || String(chunk),
              metadata: { timestamp: new Date().toISOString() }
            })
          }
        }
      }

      // Signal completion
      if (!controller.signal.aborted) {
        event.sender.send('session:streamChunk', { type: 'done' })
      }
    } catch (error) {
      event.sender.send('session:streamChunk', {
        type: 'error',
        content: error instanceof Error ? error.message : 'Stream error'
      })
    } finally {
      activeStreams.delete(sessionPath)
    }
  })

  ipcMain.on('session:stopStream', (event, { sessionPath }: { sessionPath: string }) => {
    const controller = activeStreams.get(sessionPath)
    if (controller) {
      controller.abort()
      activeStreams.delete(sessionPath)
    }
    event.sender.send('session:streamChunk', { type: 'stopped' })
  })

  // ── GSD Command Channels (Phase 2) ──

  ipcMain.handle('gsd:execute', async (_event, { command, args, cwd }) => {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const cmd = `npx --yes pi-gsd-tools ${command} ${(args || []).join(' ')}`
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: cwd || process.cwd(),
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH }
      })
      return { success: true, output: stdout, error: stderr || undefined }
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout || '',
        error: err.stderr || err.message
      }
    }
  })

  ipcMain.handle('gsd:listCommands', async () => {
    return [
      { id: 'plan-phase', name: 'plan-phase', description: '规划一个 phase', args: '<phase#>', icon: 'plan' },
      { id: 'execute-phase', name: 'execute-phase', description: '执行一个 phase', args: '<phase#>', icon: 'execute' },
      { id: 'discuss-phase', name: 'discuss-phase', description: '讨论一个 phase', args: '<phase#>', icon: 'discuss' },
      { id: 'review', name: 'review', description: 'Review 一个 phase', args: '--phase #', icon: 'review' },
      { id: 'new-project', name: 'new-project', description: '初始化新项目', args: '', icon: 'new' },
      { id: 'new-phase', name: 'new-phase', description: '添加新 phase', args: '<name>', icon: 'new' },
      { id: 'status', name: 'status', description: '查看项目状态', args: '', icon: 'status' },
      { id: 'milestone', name: 'milestone', description: '管理里程碑', args: '<name> <phase#>', icon: 'milestone' },
      { id: 'roadmap', name: 'roadmap', description: '查看 road map', args: '', icon: 'roadmap' },
    ]
  })
}