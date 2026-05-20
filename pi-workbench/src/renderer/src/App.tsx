import { useState, useCallback, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
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
    if (!window.api?.session) return
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
    if (!window.api?.session) return
    try {
      const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + '...' : firstMessage
      await window.api.session.setName(sessionPath, title)
    } catch {
      // Non-critical
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

    if (!window.api?.session) {
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))
      const sampleText = '你好！我是 pi-workbench 的 Agent 开发引擎。我已经完美切换到了 Codex 极简美学布局。\n\n* **用户消息**：采用靠右的柔和气泡聚合。\n* **AI 消息**：完全透明融入背景，剥离多余的豆腐块气泡与头像。'
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: sampleText,
          status: 'sent',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        }])
        setIsGenerating(false)
      }, 600)
      return
    }

    try {
      const wsPath = workspaces[0]?.path
      if (!wsPath) return

      let sessionPath = activeSessionPath
      if (!sessionPath) {
        const sess = await window.api.session.create(wsPath)
        sessionPath = sess.path
        setActiveSessionPath(sessionPath)
        loadConversations(wsPath)
      }

      await window.api.session.sendMessage({ sessionPath, content, images })
      setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))

      const cleanup = window.api.session.onStreamChunk((chunk) => {
        if (chunk.type === 'text') {
          setStreamingContent(prev => prev + chunk.content)
        } else if (chunk.type === 'done') {
          setMessages(prev => {
            const assistantMsg: Message = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: streamingContent,
              status: 'sent',
              timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            }
            return [...prev, assistantMsg]
          })
          setStreamingContent('')
          setIsGenerating(false)
          autoGenerateTitle(sessionPath!, content)
        }
      })

      cleanupRef.current = cleanup
      window.api.session.startStream(sessionPath)
    } catch (err) {
      console.error(err)
      setIsGenerating(false)
    }
  }, [workspaces, activeSessionPath, streamingContent, loadConversations, autoGenerateTitle])

  const handleStop = useCallback(() => {
    if (activeSessionPath && window.api?.session) window.api.session.stopStream(activeSessionPath)
    setIsGenerating(false)
  }, [activeSessionPath])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setStreamingContent('')
    setActiveConversationId(null)
    setActiveSessionPath(null)
    setIsGenerating(false)
  }, [])

  const handleSelectConversation = useCallback(async (id: string) => {
    if (!window.api?.session) return
    try {
      const data = await window.api.session.open(id)
      setActiveConversationId(id)
      setMessages(data.messages.map((m: any) => ({
        id: m.id || crypto.randomUUID(),
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: ''
      })))
      setActiveNav('chat')
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleSwitchWorkspace = useCallback((path: string) => {
    switchWorkspace(path)
    handleNewChat()
  }, [switchWorkspace, handleNewChat])

  const handleGSDCommand = useCallback(async (command: string, args: string) => {
    handleSend(`/gsd-${command} ${args}`)
  }, [handleSend])

  useEffect(() => {
    if (window.api?.gsd?.listCommands) {
      window.api.gsd.listCommands().then(setGSDCommands).catch(() => {})
    }
  }, [])

  const handleQueueAdd = useCallback((content: string) => {
    setQueue(prev => [...prev, { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() }])
  }, [])

  const chatMessages = isGenerating && streamingContent
    ? [...messages, { id: 'streaming', role: 'assistant' as const, content: streamingContent, timestamp: '' }]
    : messages

  return (
    <div className="flex h-full w-full bg-white dark:bg-[#0a0a0c] text-neutral-900 dark:text-neutral-100 overflow-hidden">
      {/* 左侧固定的侧边栏 */}
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

      {/* 右侧主舞台容器：彻底换绑为 flex-col，消除色差干扰 */}
      <main className="flex-1 h-full flex flex-col min-w-0 overflow-hidden relative bg-white dark:bg-[#0a0a0c]">
        {/* macOS 无痕透明顶栏占位区 */}
        <div className="h-[38px] w-full shrink-0 window-drag-region bg-transparent" />
        
        {/* 内容自适应区 */}
        <div className="flex-1 w-full flex flex-col min-w-0 min-h-0 relative overflow-hidden">
          {(activeNav === 'welcome' || activeNav === 'chat') && (
            <ChatPanel
              messages={chatMessages}
              isGenerating={isGenerating}
              onSend={handleSend}
              onStop={handleStop}
              onNewChat={handleNewChat}
              currentWorkspace={workspaces.length > 0 ? workspaces[0].path : undefined}
              queue={queue}
              onQueueGuide={id => setQueue(q => q.filter(x => x.id !== id))}
              onQueueDelete={id => setQueue(q => q.filter(x => x.id !== id))}
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