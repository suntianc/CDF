import { useState, useRef, useEffect } from 'react'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { WelcomeDialog } from './WelcomeDialog'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  type?: 'text' | 'thinking' | 'toolCall' | 'error'
  timestamp: string
}

interface ChatPanelProps {
  messages: Message[]
  isGenerating: boolean
  onSend: (content: string, images?: Array<{ data: string; mimeType: string }>) => void
  onStop: () => void
  onNewChat: () => void
  currentWorkspace?: string
}

export function ChatPanel({ messages, isGenerating, onSend, onStop, onNewChat, currentWorkspace }: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  // Empty state — show WelcomeDialog
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#fafafa] dark:bg-[#171717]">
        <WelcomeDialog onNewChat={onNewChat} hasWorkspace={!!currentWorkspace} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[#fafafa] dark:bg-[#171717]">
      {/* Messages list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-6 pt-16 pb-4 space-y-4"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[720px]">
              <MessageBubble message={msg} />
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <InputArea
        onSend={onSend}
        onStop={onStop}
        isGenerating={isGenerating}
        disabled={false}
      />
    </div>
  )
}