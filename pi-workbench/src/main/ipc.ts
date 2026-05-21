import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import type { Model } from '@earendil-works/pi-ai'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import store from './store'
import { chatHistoryManager } from './chatHistory'

// ── Types ──

interface ProviderConfig {
  id: string
  type: 'anthropic' | 'openai' | 'google' | 'custom'
  name: string
  apiKey: string
  baseUrl?: string
  models: string[]
  defaultModel?: string
}

interface ActiveSession {
  session: AgentSession
  window: BrowserWindow
  unsubscribe: () => void
  sessionFile: string
  sessionId: string
}

interface StreamingSession {
  session: AgentSession
  unsubscribe: () => void
  abortController: AbortController
}

// Active streaming sessions keyed by streamId
const streamingSessions = new Map<string, StreamingSession>()

interface WorkspaceGitContext {
  available: boolean
  branch: string
  changedFiles: number
  stagedFiles: number
  ahead: number
  behind: number
  lastCommit: string
}

interface WorkspaceWorkflowContext {
  available: boolean
  workflowCount: number
  currentPhase: string
  status: string
  phaseSummary: string
}

// ── Active sessions cache ──

const activeSessions = new Map<string, ActiveSession>()

// ── Streaming sessions Map (for Channel event pattern streaming) ──

// ── Helpers ──

function normalizeCustomProviderBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '')

  try {
    const url = new URL(trimmed)

    // SenseNova's token host expects OpenAI-compatible requests under `/v1`.
    if (url.hostname === 'token.sensenova.cn' && (url.pathname === '' || url.pathname === '/')) {
      return `${url.origin}/v1`
    }
  } catch {
    // Fall back to the user-provided value when URL parsing fails.
  }

  return trimmed
}

async function readWorkspaceContext(workspacePath: string): Promise<{
  git: WorkspaceGitContext
  workflow: WorkspaceWorkflowContext
}> {
  const fs = await import('fs/promises')
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  const git: WorkspaceGitContext = {
    available: false,
    branch: '未连接 Git',
    changedFiles: 0,
    stagedFiles: 0,
    ahead: 0,
    behind: 0,
    lastCommit: '暂无提交信息',
  }

  try {
    const { stdout } = await execFileAsync('git', ['-C', workspacePath, 'status', '--porcelain=2', '--branch'], {
      timeout: 5000,
    })

    git.available = true
    const lines = stdout.split('\n').filter(Boolean)
    const branchHead = lines.find((line) => line.startsWith('# branch.head '))
    const branchAb = lines.find((line) => line.startsWith('# branch.ab '))
    const fileLines = lines.filter((line) => /^[12u?]/.test(line))

    if (branchHead) {
      git.branch = branchHead.replace('# branch.head ', '').trim()
    }

    if (branchAb) {
      const aheadMatch = branchAb.match(/\+(\d+)/)
      const behindMatch = branchAb.match(/-(\d+)/)
      git.ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      git.behind = behindMatch ? Number(behindMatch[1]) : 0
    }

    git.changedFiles = fileLines.length
    git.stagedFiles = fileLines.filter((line) => {
      const status = line.slice(2, 4)
      return status[0] && status[0] !== '.'
    }).length

    try {
      const { stdout: commitStdout } = await execFileAsync(
        'git',
        ['-C', workspacePath, 'log', '-1', '--pretty=%s'],
        { timeout: 5000 },
      )
      const summary = commitStdout.trim()
      if (summary) git.lastCommit = summary
    } catch {
      // Leave default commit summary
    }
  } catch {
    // Non-git workspaces fall back to defaults
  }

  const workflow: WorkspaceWorkflowContext = {
    available: false,
    workflowCount: 0,
    currentPhase: '未检测到 GSD 状态',
    status: 'idle',
    phaseSummary: '当前工作区暂无工作流上下文',
  }

  try {
    const workflowDir = join(workspacePath, '.pi', 'gsd', 'workflows')
    const workflowFiles = await fs.readdir(workflowDir)
    workflow.workflowCount = workflowFiles.filter((name) => name.endsWith('.md')).length
    workflow.available = true
  } catch {
    // Keep defaults if no workflow directory
  }

  try {
    const statePath = join(workspacePath, '.planning', 'STATE.md')
    const stateContent = await fs.readFile(statePath, 'utf8')
    const currentPhaseMatch = stateContent.match(/current_phase:\s*(.+)/)
    const statusMatch = stateContent.match(/status:\s*(.+)/)
    const focusMatch = stateContent.match(/## Current Focus[\s\S]*?\n\n(.+?)(?:\n\n|\n\*\*Resume file)/)

    if (currentPhaseMatch) {
      workflow.currentPhase = currentPhaseMatch[1].trim()
    }
    if (statusMatch) {
      workflow.status = statusMatch[1].trim()
    }
    if (focusMatch) {
      workflow.phaseSummary = focusMatch[1].trim()
    } else if (workflow.workflowCount > 0) {
      workflow.phaseSummary = `已发现 ${workflow.workflowCount} 个 GSD workflow`
    }
    workflow.available = true
  } catch {
    if (workflow.workflowCount > 0) {
      workflow.phaseSummary = `已发现 ${workflow.workflowCount} 个 GSD workflow`
    }
  }

  return { git, workflow }
}

/**
 * Build AuthStorage + ModelRegistry from the user's stored provider configs,
 * and resolve the active model for AgentSession creation.
 *
 * @param cwd - workspace path
 * @param modelOverride - optional "provider:modelId" string to force a specific model
 */
async function buildPiServices(cwd: string, modelOverride?: string) {
  const pi = await import('@earendil-works/pi-coding-agent')
  const { AuthStorage, ModelRegistry, SessionManager } = pi

  const providers: ProviderConfig[] = store.get('providers', [])

  // 1. AuthStorage
  const authPath = join(app.getPath('userData'), 'pi-auth.json')
  const authStorage = AuthStorage.create(authPath)
  for (const p of providers) {
    if (p.apiKey) {
      authStorage.setRuntimeApiKey(p.type === 'custom' ? p.name : p.type, p.apiKey)
    }
  }

  // 2. ModelRegistry
  const modelRegistry = ModelRegistry.create(authStorage)
  modelRegistry.refresh()

  // 3. Register custom providers
  for (const p of providers) {
    if (p.type === 'custom' && p.baseUrl && p.models.length > 0) {
      const normalizedBaseUrl = normalizeCustomProviderBaseUrl(p.baseUrl)
      try {
        modelRegistry.registerProvider(p.name || p.id, {
          baseUrl: normalizedBaseUrl,
          apiKey: p.apiKey,
          authHeader: true,
          models: p.models.map((mid) => ({
            id: mid,
            name: mid,
            api: 'openai-completions' as const,
            baseUrl: normalizedBaseUrl,
            reasoning: false,
            input: ['text'] as const,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 4096,
          })),
        })
      } catch {
        // provider may already be registered — skip
      }
    }
  }

  // 4. Resolve the active model
  let model: Model<any> | undefined

  // 4a. If caller provided an explicit modelOverride ("provider:modelId")
  if (modelOverride) {
    const colonIdx = modelOverride.indexOf(':')
    if (colonIdx > 0) {
      const prov = modelOverride.slice(0, colonIdx)
      const mid = modelOverride.slice(colonIdx + 1)
      model = modelRegistry.find(prov, mid)
    }
  }

  // 4b. Fallback: use first provider's defaultModel
  if (!model) {
    const activeProvider = providers[0]
    if (activeProvider && activeProvider.defaultModel) {
      const providerName = activeProvider.type === 'custom' ? (activeProvider.name || activeProvider.id) : activeProvider.type
      model = modelRegistry.find(providerName, activeProvider.defaultModel)
      if (!model && activeProvider.type !== 'custom') {
        model = modelRegistry.find(activeProvider.type, activeProvider.defaultModel)
      }
    }
  }

  // 4c. Last resort: first available model
  if (!model) {
    model = modelRegistry.getAvailable()[0] || modelRegistry.getAll()[0]
  }

  return {
    authStorage,
    modelRegistry,
    model,
    SessionManager,
    sessionManager: SessionManager.create(cwd),
    providers, // also return providers so callers can inspect
  }
}

/**
 * Subscribe to AgentSession events and forward them to the renderer
 * as `session:streamChunk` IPC messages.
 */
function subscribeSessionEvents(
  session: AgentSession,
  browserWindow: BrowserWindow,
): () => void {
  return session.subscribe((event) => {
    if (browserWindow.isDestroyed()) return
    const send = (chunk: Record<string, unknown>) => {
      browserWindow.webContents.send('session:streamChunk', chunk)
    }

    switch (event.type) {
      // ── Streaming text deltas ──
      case 'message_update': {
        const ev = event.assistantMessageEvent
        if (ev.type === 'text_delta') {
          send({ type: 'text', content: ev.delta })
        } else if (ev.type === 'thinking_delta') {
          send({ type: 'thinking', content: ev.delta })
        }
        break
      }

      // ── Message lifecycle ──
      case 'message_start':
        send({ type: 'message_start' })
        break
      case 'message_end':
        break

      // ── Agent lifecycle ──
      case 'agent_start':
        send({ type: 'agent_start' })
        break
      case 'agent_end':
        send({ type: 'done' })
        break

      // ── Tool execution ──
      case 'tool_execution_start':
        send({ type: 'tool_start', name: event.toolName, args: event.args })
        break
      case 'tool_execution_update':
        send({ type: 'tool_output', content: JSON.stringify(event.partialResult) })
        break
      case 'tool_execution_end':
        send({ type: 'tool_end', name: event.toolName, isError: event.isError })
        break

      // ── Compaction / retry (informational) ──
      case 'compaction_start':
        send({ type: 'info', content: '🔄 压缩上下文...' })
        break
      case 'compaction_end':
        send({ type: 'info', content: `✅ 压缩完成` })
        break
      case 'auto_retry_start':
        send({ type: 'info', content: `🔄 重试 #${event.attempt}...` })
        break
      case 'auto_retry_end':
        send({ type: event.success ? 'info' : 'error', content: event.success ? '✅ 重试成功' : `❌ 重试失败: ${event.finalError}` })
        break
    }
  })
}

// ── IPC Handler Registration ──

export function registerIpcHandlers(): void {
  // ── Store ──
  ipcMain.handle('store:get', (_event, key: string) => store.get(key as any))
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key as any, value)
    return true
  })
  ipcMain.handle('store:delete', (_event, key: string) => {
    store.delete(key as any)
    return true
  })

  // ── Folder dialog ──
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── Workspace ──
  ipcMain.handle('workspace:list', () => store.get('workspaces', []))
  ipcMain.handle('workspace:add', (_event, workspacePath: string) => {
    const workspaces = store.get('workspaces', [])
    const existing = workspaces.find(w => w.path === workspacePath)
    if (!existing) {
      workspaces.push({
        path: workspacePath,
        name: workspacePath.split('/').pop() || workspacePath,
        lastOpened: new Date().toISOString(),
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
  ipcMain.handle('workspace:getContext', async (_event, workspacePath: string) => {
    return readWorkspaceContext(workspacePath)
  })

  // ── Theme ──
  ipcMain.handle('theme:get', () => store.get('theme', 'system'))
  ipcMain.handle('theme:set', (_event, theme: 'light' | 'dark' | 'system') => {
    store.set('theme', theme)
    return true
  })

  // ── Providers ──
  ipcMain.handle('providers:list', () => store.get('providers', []))
  ipcMain.handle('providers:save', (_event, provider: Record<string, unknown>) => {
    const providers = store.get('providers', [])
    const idx = providers.findIndex((p: any) => p.id === provider.id)
    if (idx >= 0) {
      providers[idx] = provider as any
    } else {
      providers.push(provider as any)
    }
    store.set('providers', providers)
    return true
  })
  ipcMain.handle('providers:delete', (_event, providerId: string) => {
    const providers = store.get('providers', [])
    store.set('providers', providers.filter((p: any) => p.id !== providerId))
    return true
  })
  ipcMain.handle('providers:test', async (_event, _provider: Record<string, unknown>) => {
    return { success: true, message: 'Connection test stub' }
  })

  /**
   * providers:getAvailableModels()
   * 只返回用户在设置中已配置并保存了的默认模型（决绝全量内置列表混淆视听）
   */
  ipcMain.handle('providers:getAvailableModels', async () => {
    try {
      const providers: ProviderConfig[] = store.get('providers', [])
      if (providers.length === 0) return []

      return providers
        .filter((p) => p.defaultModel)
        .map((p) => ({
          provider: p.type === 'custom' ? (p.name || p.id) : p.type,
          id: p.defaultModel!,
          name: p.defaultModel!,
        }))
    } catch (err) {
      console.error('[ipc] getAvailableModels error:', err)
      return []
    }
  })

  // ── Window state ──
  ipcMain.handle('window:stateSave', (_event, state: Record<string, unknown>) => {
    store.set('windowState', state)
    return true
  })

  // ══════════════════════════════════════════════════════════════════
  //  Session IPC Channels — powered by pi SDK AgentSession
  // ══════════════════════════════════════════════════════════════════

  /**
   * session:create(cwd, modelId?)
   * Creates a fresh AgentSession with the user's provider config.
   * Caches the session for streaming.
   */
  ipcMain.handle('session:create', async (event, cwd: string, modelId?: string) => {
    // Clean up any previous active session
    for (const [path, entry] of activeSessions) {
      entry.unsubscribe()
      entry.session.dispose()
      activeSessions.delete(path)
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) throw new Error('No browser window')

    try {
      const pi = await import('@earendil-works/pi-coding-agent')
      const { createAgentSession } = pi
      const services = await buildPiServices(cwd, modelId)

      if (!services.model) {
        throw new Error('没有可用的模型。请先在设置中配置 AI 提供商和 API Key。')
      }

      const { session } = await createAgentSession({
        cwd,
        model: services.model,
        authStorage: services.authStorage,
        modelRegistry: services.modelRegistry,
        sessionManager: services.sessionManager,
        tools: ['read', 'bash', 'grep', 'find', 'ls'],
      })

      const unsubscribe = subscribeSessionEvents(session, browserWindow)

      const sessionFile = session.sessionFile || ''
      const sessionId = session.sessionId

      activeSessions.set(sessionFile || sessionId, {
        session,
        window: browserWindow,
        unsubscribe,
        sessionFile,
        sessionId,
      })

      return {
        id: sessionId,
        path: sessionFile,
        name: session.sessionName || '',
        modelProvider: services.model.provider,
        modelId: services.model.id,
      }
    } catch (err) {
      console.error('[ipc] session:create error:', err)
      throw err
    }
  })

  /**
   * session:list(cwd)
   * Lists all JSONL session files in the workspace.
   */
  ipcMain.handle('session:list', async (_event, cwd: string) => {
    const { SessionManager } = await import('@earendil-works/pi-coding-agent')
    const sessions = await SessionManager.list(cwd)
    return sessions.map((s: any) => ({
      id: s.id,
      path: s.path,
      name: s.name || '',
      createdAt: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      messageCount: s.messageCount || 0,
    }))
  })

  /**
   * session:open(sessionPath)
   * Opens an existing session file and sets up an AgentSession.
   * Returns full message history.
   */
  ipcMain.handle('session:open', async (event, sessionPath: string) => {
    // Clean up previous session
    for (const [path, entry] of activeSessions) {
      entry.unsubscribe()
      entry.session.dispose()
      activeSessions.delete(path)
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) throw new Error('No browser window')

    try {
      const pi = await import('@earendil-works/pi-coding-agent')
      const { createAgentSession, SessionManager } = pi
      const services = await buildPiServices(store.get('lastWorkspace') || process.cwd())

      const { session } = await createAgentSession({
        cwd: store.get('lastWorkspace') || process.cwd(),
        model: services.model,
        authStorage: services.authStorage,
        modelRegistry: services.modelRegistry,
        sessionManager: SessionManager.open(sessionPath),
        tools: ['read', 'bash', 'grep', 'find', 'ls'],
      })

      const unsubscribe = subscribeSessionEvents(session, browserWindow)

      const file = session.sessionFile || sessionPath
      const id = session.sessionId

      activeSessions.set(file, {
        session,
        window: browserWindow,
        unsubscribe,
        sessionFile: file,
        sessionId: id,
      })

      // Build message list from loaded session
      const messages = session.messages
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => {
          const text = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((c: any) => c.text || c.data || '').join(' ')
              : ''
          return {
            id: m.id || crypto.randomUUID(),
            role: m.role,
            content: text,
            timestamp: m.createdAt || '',
          }
        })

      return {
        id,
        name: session.sessionName || '',
        path: file,
        messages,
        settings: {},
      }
    } catch (err) {
      console.error('[ipc] session:open error:', err)
      throw err
    }
  })

  /**
   * session:sendMessage({ sessionPath, content, images })
   * Sends a user message via AgentSession.prompt().
   * Streaming events come back through the subscription → session:streamChunk.
   * This is fire-and-forget: the handler returns immediately.
   */
  ipcMain.handle('session:sendMessage', async (_event, { sessionPath, content, images }: {
    sessionPath: string
    content: string
    images?: Array<{ data: string; mimeType: string }>
  }) => {
    const entry = activeSessions.get(sessionPath)
    if (!entry) {
      throw new Error(`Session not found: ${sessionPath}. Call session:create or session:open first.`)
    }

    const { session } = entry

    if (images && images.length > 0) {
      // Images: use sendUserMessage which accepts (TextContent | ImageContent)[]
      const imageContents = images.map((img) => ({
        type: 'image' as const,
        data: img.data,
        mimeType: img.mimeType,
      }))

      session.sendUserMessage(
        [{ type: 'text' as const, text: content }, ...imageContents],
        { deliverAs: 'steer' },
      ).catch((err: Error) => {
        if (!entry.window.isDestroyed()) {
          entry.window.webContents.send('session:streamChunk', {
            type: 'error',
            content: err.message,
          })
        }
      })
    } else {
      // Plain text
      session.prompt(content).catch((err: Error) => {
        if (!entry.window.isDestroyed()) {
          entry.window.webContents.send('session:streamChunk', {
            type: 'error',
            content: err.message,
          })
        }
      })
    }

    return { success: true }
  })

  /**
   * session:setName({ sessionPath, name })
   */
  ipcMain.handle('session:setName', async (_event, { sessionPath, name }: { sessionPath: string; name: string }) => {
    const entry = activeSessions.get(sessionPath)
    if (entry) {
      entry.session.setSessionName(name)
    }
    return { success: true }
  })

  /**
   * session:setModel({ sessionPath, modelId })
   * Changes the model for the active session (provider:modelId format).
   */
  ipcMain.handle('session:setModel', async (_event, { sessionPath, modelId }: { sessionPath: string; modelId: string }) => {
    const entry = activeSessions.get(sessionPath)
    if (!entry) throw new Error('Session not found')

    const colonIdx = modelId.indexOf(':')
    if (colonIdx <= 0) throw new Error('Invalid modelId format — expected "provider:modelId"')

    const prov = modelId.slice(0, colonIdx)
    const mid = modelId.slice(colonIdx + 1)
    const model = entry.session.modelRegistry.find(prov, mid)
    if (!model) throw new Error(`Model not found: ${modelId}`)

    await entry.session.setModel(model)
    return { success: true, modelProvider: model.provider, modelId: model.id }
  })

  /**
   * session:delete(sessionPath)
   */
  ipcMain.handle('session:delete', async (_event, sessionPath: string) => {
    const entry = activeSessions.get(sessionPath)
    if (entry) {
      entry.unsubscribe()
      entry.session.dispose()
      activeSessions.delete(sessionPath)
    }

    const fs = await import('fs/promises')
    await fs.unlink(sessionPath)
    return { success: true }
  })

  /**
   * session:streamStart({ sessionPath })
   * Starts pi SDK streaming for a session using Channel event pattern (D-02).
   * Generates unique streamId, creates a new AgentSession, subscribes to session events,
   * and forwards tokens via the unique channel (stream-{id}). Returns streamId to renderer.
   */
  ipcMain.handle('session:streamStart', async (event, { sessionPath }: { sessionPath: string }) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    if (!browserWindow) throw new Error('No browser window')

    // Generate unique streamId for this streaming session
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create AbortController for this stream (informational, SDK doesn't support abort)
    const abortController = new AbortController()

    try {
      // Extract workspace directory from session path
      const cwd = dirname(sessionPath)

      // Build services and create a new AgentSession for this stream
      const services = await buildPiServices(cwd)

      if (!services.model) {
        throw new Error('没有可用的模型。请先在设置中配置 AI 提供商和 API Key。')
      }

      const pi = await import('@earendil-works/pi-coding-agent')
      const { createAgentSession } = pi

      const { session } = await createAgentSession({
        cwd,
        model: services.model,
        authStorage: services.authStorage,
        modelRegistry: services.modelRegistry,
        sessionManager: services.sessionManager,
        tools: ['read', 'bash', 'grep', 'find', 'ls'],
      })

      // Subscribe to session events and forward tokens via the unique streamId channel
      const unsubscribe = session.subscribe((ev: any) => {
        if (abortController.signal.aborted) return

        if (ev.type === 'message_update' && ev.assistantMessageEvent?.type === 'text_delta') {
          const delta = ev.assistantMessageEvent.delta
          browserWindow.webContents.send(streamId, { type: 'token', delta })
        } else if (ev.type === 'message_end') {
          browserWindow.webContents.send(streamId, { type: 'end' })
        } else if (ev.type === 'error' || ev.type === 'agent_error') {
          browserWindow.webContents.send(streamId, { type: 'error', message: ev.errorMessage || 'Unknown error' })
        }
      })

      // Store the session for cleanup on streamStop
      streamingSessions.set(streamId, { session, unsubscribe, abortController })

      return streamId
    } catch (err: any) {
      browserWindow.webContents.send(streamId, { type: 'error', message: err.message })
      throw err
    }
  })

  /**
   * session:streamStop({ streamId })
   * Stops the active stream by disposing the AgentSession.
   */
  ipcMain.on('session:streamStop', (_event, { streamId }: { streamId: string }) => {
    const entry = streamingSessions.get(streamId)
    if (entry) {
      entry.abortController.abort()
      entry.unsubscribe()
      entry.session.dispose()
      streamingSessions.delete(streamId)
    }
  })

  // ══════════════════════════════════════════════════════════════════
  //  Chat History IPC Channels
  // ══════════════════════════════════════════════════════════════════

  /**
   * chatHistory:create
   * Creates a new conversation file and returns id and path.
   */
  ipcMain.handle('chatHistory:create', async (_event, { workspacePath, name }: { workspacePath: string; name?: string }) => {
    return chatHistoryManager.createConversation(workspacePath, name)
  })

  /**
   * chatHistory:list
   * Lists all conversations for a workspace, sorted by updatedAt.
   */
  ipcMain.handle('chatHistory:list', async (_event, { workspacePath }: { workspacePath: string }) => {
    return chatHistoryManager.listConversations(workspacePath)
  })

  /**
   * chatHistory:load
   * Loads messages from a conversation with pagination (default 50).
   */
  ipcMain.handle('chatHistory:load', async (_event, { path, offset, limit }: { path: string; offset?: number; limit?: number }) => {
    return chatHistoryManager.loadConversation(path, offset ?? 0, limit ?? 50)
  })

  /**
   * chatHistory:save
   * Saves (replaces) all messages in a conversation.
   */
  ipcMain.handle('chatHistory:save', async (_event, { path, messages }: { path: string; messages: any[] }) => {
    await chatHistoryManager.saveConversation(path, messages)
    return { success: true }
  })

  /**
   * chatHistory:append
   * Appends a single message to a conversation.
   */
  ipcMain.handle('chatHistory:append', async (_event, { path, message }: { path: string; message: any }) => {
    await chatHistoryManager.appendMessage(path, message)
    return { success: true }
  })

  /**
   * chatHistory:delete
   * Deletes a conversation file.
   */
  ipcMain.handle('chatHistory:delete', async (_event, { path }: { path: string }) => {
    await chatHistoryManager.deleteConversation(path)
    return { success: true }
  })

  /**
   * chatHistory:updateMeta
   * Updates conversation metadata (e.g., name).
   */
  ipcMain.handle('chatHistory:updateMeta', async (_event, { path, meta }: { path: string; meta: any }) => {
    await chatHistoryManager.updateConversationMeta(path, meta)
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════════
  //  GSD Command Channels
  // ══════════════════════════════════════════════════════════════════

  ipcMain.handle('gsd:execute', async (_event, { command, args, cwd }) => {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const cmd = `npx --yes pi-gsd-tools ${command} ${(args || []).join(' ')}`
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: cwd || process.cwd(),
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH },
      })
      return { success: true, output: stdout, error: stderr || undefined }
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout || '',
        error: err.stderr || err.message,
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
