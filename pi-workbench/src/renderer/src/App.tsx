import { useState, useCallback } from 'react'
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

function App(): React.ReactElement {
  const [activeNav, setActiveNav] = useState('welcome')
  const { workspaces, addWorkspace, switchWorkspace } = useWorkspace()

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  const handleNavigate = useCallback((page: string) => {
    setActiveNav(page)
  }, [])

  // Chat handlers
  const handleSend = useCallback((content: string, images?: Array<{ data: string; mimeType: string }>) => {
    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      status: 'sending',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    setMessages(prev => [...prev, userMsg])
    setIsGenerating(true)

    // Send via IPC (when available from IPC layer)
    if (window.api?.session?.sendMessage && workspaces[0]?.path) {
      // Create session if needed (simplified — full flow in Plan 03)
      window.api.session.sendMessage({
        sessionPath: '',
        content,
        images
      }).then(() => {
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))
      }).catch(() => {
        // IPC not wired yet — show as sent anyway for now
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, status: 'sent' } : m))
      })
    }
  }, [workspaces])

  const handleStop = useCallback(() => {
    setIsGenerating(false)
    setMessages(prev => {
      // Mark last AI message as stopped
      const lastAi = [...prev].reverse().find(m => m.role === 'assistant')
      return lastAi ? prev.map(m => m.id === lastAi.id ? { ...m, status: 'stopped' } : m) : prev
    })
  }, [])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setActiveConversationId(null)
    setIsGenerating(false)
  }, [])

  const handleSwitchWorkspace = useCallback((path: string) => {
    switchWorkspace(path)
    setMessages([])
    setActiveConversationId(null)
  }, [switchWorkspace])

  return (
    <div className="flex h-full bg-[#fafafa] dark:bg-[#171717] text-[#171717] dark:text-white">
      <Sidebar
        activeNav={activeNav}
        onNavigate={handleNavigate}
        workspaces={workspaces}
        onAddWorkspace={addWorkspace}
        onSwitchWorkspace={handleSwitchWorkspace}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          setActiveConversationId(id)
          setActiveNav('chat')
        }}
        onNewConversation={handleNewChat}
      />

      <main className="flex-1 flex flex-col">
        {/* Main content drag region */}
        <div className="h-[38px] w-full shrink-0 window-drag-region" />
        <div className="flex-1 flex">
          {activeNav === 'welcome' || activeNav === 'chat' ? (
            <ChatPanel
              messages={messages}
              isGenerating={isGenerating}
              onSend={handleSend}
              onStop={handleStop}
              onNewChat={handleNewChat}
              currentWorkspace={workspaces.length > 0 ? workspaces[0].path : undefined}
            />
          ) : activeNav === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

export default App