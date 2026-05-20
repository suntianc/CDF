import { useState, useCallback, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { WelcomeDialog } from './components/WelcomeDialog'
import { SettingsPage } from './pages/SettingsPage'
import { useWorkspace } from './hooks/useWorkspace'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  timestamp: string
}

interface Conversation {
  id: string
  name: string
  createdAt: string
}

interface QueuedMessage {
  id: string
  content: string
  createdAt: string
}

interface GSDCommand {
  id: string
  name: string
  description: string
  args: string
  icon: string
}

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState('welcome')
  const { workspaces, addWorkspace, switchWorkspace } = useWorkspace()

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [gsdCommands, setGSDCommands] = useState<GSDCommand[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  const handleNavigate = useCallback((page: string) => {
    setActiveNav(page)
  }, [])

  // ── Session persistence ──

  const loadConversations = useCallback(async (wsPath: string) => {
    try {
      const sessionList = await window.api.session.list(wsPath)
      setConversations(sessionList.map(s => ({
        id: s.id,
        name: s.name || `对话 ${new Date(s.createdAt).toLocaleDateString('zh-CN')}`,
        createdAt: s.createdAt
      })))
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }, [])

  const autoGenerateTitle = useCallback(async (sessionPath: string, firstMessage: string) => {
    try {
      const title = firstMessage.length > 50
        ? firstMessage.slice(0, 50) + '...'
        : firstMessage
      await window.api.session.setName(sessionPath, title)
    } catch {
      // Title generation is non-critical
    }
  }, [])

  // ── Chat handlers ──

  const handleSend = useCallback(async (content: string, images?: Array<{ data: string; mimeType: string }>) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      status: 'sending',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    setMessages(prev => [...prev, userMsg])
    setIsGenerating(true)
    setStreamingContent('')

    // ── Dev mode fallback (browser, no Electron IPC) ──
    if (!window.api?.session) {
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))
      const sampleText = '你好！我是 AI assistant。\n\n我可以帮你：\n\n1. **编写代码** — 支持 TypeScript、Python、Rust 等\n2. **分析问题** — 帮助调试和理解复杂代码\n3. **写作辅助** — 起草文档、报告等内容\n\n```typescript\nconst greeting = \"Hello World\";\nconsole.log(greeting);\n```\n\n有什么我可以帮你的吗？'
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: sampleText,
          status: 'sent',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }])
        setIsGenerating(false)
      }, 800)
      return
    }

    // ── Real IPC path (Electron) ──
    try {
      const wsPath = workspaces[0]?.path
      if (!wsPath) return

      // Create session if needed
      let sessionPath = activeSessionPath
      if (!sessionPath) {
        const sess = await window.api.session.create(wsPath)
        sessionPath = sess.path
        setActiveSessionPath(sessionPath)
        loadConversations(wsPath)
      }

      // Send message
      await window.api.session.sendMessage({ sessionPath, content, images })

      // Update user message status to 'sent'
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))

      // Subscribe to stream
      const cleanup = window.api.session.onStreamChunk((chunk) => {
        if (chunk.type === 'text') {
          setStreamingContent(prev => prev + chunk.content)
        } else if (chunk.type === 'done') {
          setMessages(prev => {
            const finalContent = streamingContent
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: finalContent,
              status: 'sent',
              timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            }
            return [...prev, assistantMsg]
          })
          setStreamingContent('')
          setIsGenerating(false)
          autoGenerateTitle(sessionPath!, content)
        } else if (chunk.type === 'error') {
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `回复出错：${chunk.content}`,
            status: 'stopped',
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          }])
          setStreamingContent('')
          setIsGenerating(false)
        }
      })

      cleanupRef.current = cleanup
      window.api.session.startStream(sessionPath)

    } catch (err) {
      console.error('Send failed:', err)
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'stopped' } : m))
      setIsGenerating(false)
    }
  }, [workspaces, activeSessionPath, streamingContent, loadConversations, autoGenerateTitle])

  const handleStop = useCallback(() => {
    if (activeSessionPath && window.api?.session) {
      window.api.session.stopStream(activeSessionPath)
    }
    // Finalize streaming content as stopped AI message
    if (streamingContent) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: streamingContent + '\n\n*（已停止）*',
        status: 'stopped',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }])
    }
    setStreamingContent('')
    setIsGenerating(false)
  }, [activeSessionPath, streamingContent])

  const handleNewChat = useCallback(async () => {
    // Auto-save current conversation if it has content
    if (messages.length > 0 && activeSessionPath) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        await autoGenerateTitle(activeSessionPath, firstUserMsg.content)
      }
    }

    // Clear state
    setMessages([])
    setStreamingContent('')
    setActiveConversationId(null)
    setActiveSessionPath(null)
    setIsGenerating(false)
  }, [messages, activeSessionPath, autoGenerateTitle])

  const handleSelectConversation = useCallback(async (id: string) => {
    try {
      const wsPath = workspaces[0]?.path
      if (!wsPath) return

      const sessionList = await window.api.session.list(wsPath)
      const session = sessionList.find(s => s.id === id)
      if (!session) return

      const data = await window.api.session.open(id)
      setActiveConversationId(id)
      setMessages(data.messages.map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      })))
      setActiveNav('chat')
    } catch (err) {
      console.error('Failed to load conversation:', err)
    }
  }, [workspaces])

  const handleSwitchWorkspace = useCallback((path: string) => {
    switchWorkspace(path)
    setMessages([])
    setActiveConversationId(null)
    setActiveSessionPath(null)
    loadConversations(path)
  }, [switchWorkspace, loadConversations])

  // GSD command execution
  const handleGSDCommand = useCallback(async (command: string, args: string) => {
    // Add user message showing the command
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `/gsd-${command} ${args}`,
      status: 'sent',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    setMessages(prev => [...prev, userMsg])

    // Execute GSD command
    try {
      const wsPath = workspaces[0]?.path
      const result = await window.api.gsd.execute(command, args.split(/\s+/), wsPath)

      // Add result as AI message with special type
      const resultMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: JSON.stringify({ type: 'gsd', command, success: result.success, output: result.output, error: result.error }),
        status: 'sent',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      setMessages(prev => [...prev, resultMsg])
    } catch (err: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: JSON.stringify({ type: 'gsd', command, success: false, output: '', error: err.message }),
        status: 'sent',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      setMessages(prev => [...prev, errorMsg])
    }
  }, [workspaces])

  // Load GSD commands on mount
  useEffect(() => {
    if (window.api?.gsd?.listCommands) {
      window.api.gsd.listCommands()
        .then(setGSDCommands)
        .catch(() => {})
    }
  }, [])

  // Queue handlers
  const handleQueueAdd = useCallback((content: string) => {
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString()
    }
    setQueue(prev => [...prev, item])
  }, [])

  const handleQueueGuide = useCallback((id: string) => {
    const item = queue.find(q => q.id === id)
    if (!item) return

    if (isGenerating && activeSessionPath) {
      window.api.session.stopStream(activeSessionPath)
    }

    setMessages(prev => {
      const lastAi = [...prev].reverse().find(m => m.role === 'assistant')
      if (lastAi) {
        return prev.map(m => m.id === lastAi.id ? { ...m, status: 'guided' as const } : m)
      }
      return prev
    })

    setQueue(prev => prev.filter(q => q.id !== id))
    handleSend(item.content)
  }, [queue, isGenerating, activeSessionPath, handleSend])

  const handleQueueDelete = useCallback((id: string) => {
    setQueue(prev => prev.filter(q => q.id !== id))
  }, [])

  // Clean up stream listener on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  // Build message list with streaming indicator
  const chatMessages = isGenerating && streamingContent
    ? [...messages, { id: 'streaming', role: 'assistant' as const, content: streamingContent, timestamp: '' }]
    : messages

  return (
    <div className="flex h-full w-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white overflow-hidden antialiased">
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

      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden relative">
        {/* Main content drag region */}
        <div className="h-[38px] w-full shrink-0 window-drag-region" />
        <div className="flex-1 w-full flex overflow-hidden min-w-0 min-h-0 relative">
          {(activeNav === 'welcome' || activeNav === 'chat') && (
            <ChatPanel
              messages={chatMessages}
              isGenerating={isGenerating}
              onSend={handleSend}
              onStop={handleStop}
              onNewChat={handleNewChat}
              currentWorkspace={workspaces.length > 0 ? workspaces[0].path : undefined}
              queue={queue}
              onQueueGuide={handleQueueGuide}
              onQueueDelete={handleQueueDelete}
              onGSDCommand={handleGSDCommand}
              gsdCommands={gsdCommands}
              onQueueAdd={handleQueueAdd}
            />
          )}
          {activeNav === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

export default App