import { useState, useCallback, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPage } from './pages/SettingsPage'
import { useWorkspace } from './hooks/useWorkspace'
import { PiRuntimeProvider } from './components/assistant-ui'

// ── Types ──

interface ToolBlock {
  name: string
  args: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  timestamp: string
  thinking?: string          // accumulated thinking text, rendered as ThinkingBlock
  tools?: ToolBlock[]        // tool call blocks, rendered as ToolCallCard
}

interface Conversation {
  id: string
  path: string
  name: string
  createdAt: string
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''

        const typedPart = part as Record<string, unknown>
        if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
          return typedPart.text
        }
        if (typedPart.type === 'input_text' && typeof typedPart.text === 'string') {
          return typedPart.text
        }
        if (typedPart.type === 'output_text' && typeof typedPart.text === 'string') {
          return typedPart.text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    const maybeText = (content as Record<string, unknown>).text
    if (typeof maybeText === 'string') return maybeText
  }

  return ''
}

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState('welcome')
  const { workspaces, addWorkspace, switchWorkspace } = useWorkspace()

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const selectedModelRef = useRef('')

  // Model state
  const [availableModels, setAvailableModels] = useState<Array<{ provider: string; id: string; name: string }>>([])
  const [selectedModel, setSelectedModel] = useState<string>('')

  // Streaming refs (avoid stale closures in stream callbacks)
  const streamingContentRef = useRef('')
  const streamingThinkingRef = useRef('')
  const streamingToolsRef = useRef<ToolBlock[]>([])

  // Force re-render when streaming blocks change
  const [, forceUpdate] = useState(0)

  const handleNavigate = useCallback((page: string) => {
    setActiveNav(page)
  }, [])

  // ── Session persistence ──
  const loadConversations = useCallback(async (wsPath: string) => {
    if (!window.api?.session) return
    try {
      const sessionList = await window.api.session.list(wsPath)
      setConversations(sessionList.map(s => ({
        id: s.path || s.id,
        path: s.path || s.id,
        name: s.name || `对话 ${new Date(s.createdAt).toLocaleDateString('zh-CN')}`,
        createdAt: s.createdAt
      })))
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }, [])

  const autoGenerateTitle = useCallback(async (sessionPath: string, firstMessage: string) => {
    if (!window.api?.session) return
    try {
      const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + '...' : firstMessage
      await window.api.session.setName(sessionPath, title)
    } catch {
      // Non-critical
    }
  }, [])

  // ── Helper: flush streaming blocks into a final Message ──
  const flushStreamingMessage = useCallback((status: Message['status'] = 'sent'): Message | null => {
    const content = streamingContentRef.current
    const thinking = streamingThinkingRef.current
    const tools = streamingToolsRef.current.length > 0 ? [...streamingToolsRef.current] : undefined

    // Reset refs
    streamingContentRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []

    // Only create a message if there's actual content
    if (!content && !thinking && !tools) return null

    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: content || '',
      status,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      thinking: thinking || undefined,
      tools,
    }
  }, [])

  // ── Chat handlers ──
  const handleSend = useCallback(async (content: string, images?: Array<{ data: string; mimeType: string }>) => {
    if (!window.api?.session) {
      console.error('session API not available')
      return
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      status: 'sending',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    setMessages(prev => [...prev, userMsg])
    setIsGenerating(true)
    streamingContentRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
    forceUpdate(n => n + 1)

    try {
      const wsPath = workspaces[0]?.path
      if (!wsPath) return

      let sessionPath = activeSessionPath
      if (!sessionPath) {
        const sess = await window.api.session.create(wsPath, selectedModel || undefined)
        sessionPath = sess.path
        setActiveSessionPath(sessionPath)
        // Update selected model from what the session actually resolved
        if (sess.modelId) {
          setSelectedModel(`${sess.modelProvider}:${sess.modelId}`)
        }
        loadConversations(wsPath)
      }

      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      const cleanup = window.api.session.onStreamChunk((chunk) => {
        switch (chunk.type) {
          case 'agent_start':
            setIsGenerating(true)
            streamingContentRef.current = ''
            streamingThinkingRef.current = ''
            streamingToolsRef.current = []
            forceUpdate(n => n + 1)
            break

          case 'text':
            streamingContentRef.current += (chunk.content || '')
            forceUpdate(n => n + 1)
            break

          case 'thinking':
            streamingThinkingRef.current += (chunk.content || '')
            forceUpdate(n => n + 1)
            break

          case 'tool_start': {
            streamingToolsRef.current = [
              ...streamingToolsRef.current,
              {
                name: chunk.name || 'unknown',
                args: chunk.args || {},
                status: 'running' as const,
              },
            ]
            forceUpdate(n => n + 1)
            break
          }

          case 'tool_output': {
            const tools = [...streamingToolsRef.current]
            const last = tools[tools.length - 1]
            if (last) {
              last.result = (last.result || '') + (chunk.content || '')
            }
            streamingToolsRef.current = tools
            forceUpdate(n => n + 1)
            break
          }

          case 'tool_end': {
            const tools = [...streamingToolsRef.current]
            const last = tools[tools.length - 1]
            if (last) {
              last.status = chunk.isError ? 'error' : 'completed'
            }
            streamingToolsRef.current = tools
            forceUpdate(n => n + 1)
            break
          }

          case 'done': {
            const finalMsg = flushStreamingMessage('sent')
            if (finalMsg) {
              setMessages(prev => [...prev, finalMsg])
            }
            setIsGenerating(false)
            if (sessionPath) autoGenerateTitle(sessionPath, content)
            break
          }

          case 'error':
            setMessages(prev => [...prev, {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `❌ **错误**: ${chunk.content || '未知错误'}`,
              status: 'stopped',
              timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            }])
            streamingContentRef.current = ''
            streamingThinkingRef.current = ''
            streamingToolsRef.current = []
            setIsGenerating(false)
            break

          case 'stopped': {
            const partial = flushStreamingMessage('stopped')
            if (partial) {
              setMessages(prev => [...prev, partial])
            }
            setIsGenerating(false)
            break
          }

          case 'info':
            // status info (compaction, retry etc.) — could show in a status bar
            break
        }
      })

      cleanupRef.current = cleanup

      // Mark user message as sent
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))

      // Send message — triggers the AI stream via AgentSession.prompt()
      await window.api.session.sendMessage({ sessionPath, content, images })
    } catch (err) {
      console.error('[handleSend] error:', err)
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `❌ **发送失败**: ${err instanceof Error ? err.message : '未知错误'}`,
        status: 'stopped',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      }])
      setIsGenerating(false)
      streamingContentRef.current = ''
      streamingThinkingRef.current = ''
      streamingToolsRef.current = []
    }
  }, [workspaces, activeSessionPath, selectedModel, loadConversations, autoGenerateTitle, flushStreamingMessage])

  const handleStop = useCallback(() => {
    if (activeSessionPath && window.api?.session) window.api.session.stopStream(activeSessionPath)
    setIsGenerating(false)
  }, [activeSessionPath])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setActiveConversationId(null)
    setActiveSessionPath(null)
    setIsGenerating(false)
    streamingContentRef.current = ''
    streamingThinkingRef.current = ''
    streamingToolsRef.current = []
  }, [])

  const handleSelectConversation = useCallback(async (sessionPath: string) => {
    if (!window.api?.session) return
    try {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      const data = await window.api.session.open(sessionPath)
      setActiveConversationId(sessionPath)
      setActiveSessionPath(data.path || sessionPath)
      setMessages(data.messages.map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        content: extractMessageText(m.content),
        timestamp: '',
      })))
      setActiveNav('chat')
    } catch (err) {
      console.error('Failed to open conversation:', err)
    }
  }, [])

  const handleSwitchWorkspace = useCallback((path: string) => {
    switchWorkspace(path)
    handleNewChat()
  }, [switchWorkspace, handleNewChat])





  // Init model from available models on mount
  useEffect(() => {
    const init = async () => {
      if (!window.api?.session?.getAvailableModels) return
      try {
        const models = await window.api.session.getAvailableModels()
        setAvailableModels(models)
        if (models.length > 0 && !selectedModelRef.current) {
          const first = `${models[0].provider}:${models[0].id}`
          selectedModelRef.current = first
          setSelectedModel(first)
        }
      } catch {}
    }
    init()

  }, [])

  // Sync ref
  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  const handleModelChange = useCallback(async (modelId: string) => {
    setSelectedModel(modelId)
    selectedModelRef.current = modelId
    if (activeSessionPath && window.api?.session?.setModel) {
      try {
        const result = await window.api.session.setModel(activeSessionPath, modelId)
        if (result.modelId) {
          const resolved = `${result.modelProvider}:${result.modelId}`
          setSelectedModel(resolved)
          selectedModelRef.current = resolved
        }
      } catch (err) {
        console.error('Failed to switch model:', err)
      }
    }
  }, [activeSessionPath])

  const chatMessages = isGenerating
    ? [
        ...messages,
        {
          id: 'streaming',
          role: 'assistant' as const,
          content: streamingContentRef.current,
          timestamp: '',
          thinking: streamingThinkingRef.current || undefined,
          tools: streamingToolsRef.current.length > 0 ? [...streamingToolsRef.current] : undefined,
        }
      ]
    : messages

  return (
    <div className="flex h-full w-full bg-white dark:bg-[#0a0a0c] text-neutral-900 dark:text-neutral-100 overflow-hidden antialiased">
      <Sidebar
        activeNav={activeNav}
        onNavigate={handleNavigate}
        workspaces={workspaces}
        onAddWorkspace={addWorkspace}
        onSwitchWorkspace={handleSwitchWorkspace}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewChat}
      />

      <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden relative bg-[#fcfcfc] dark:bg-[#0d0d10]">
        <div className="h-[38px] w-full shrink-0 window-drag-region bg-transparent" />

        <div className="flex-1 w-full flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {(activeNav === 'welcome' || activeNav === 'chat') && (
            <PiRuntimeProvider
              value={{
                messages: chatMessages,
                isGenerating,
                onSend: handleSend,
                onStop: handleStop,
                isStreamingContent: isGenerating,
                availableModels,
                selectedModel,
                onModelChange: handleModelChange,
              }}
            >
              <ChatPanel />
            </PiRuntimeProvider>
          )}
          {activeNav === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

export default App
