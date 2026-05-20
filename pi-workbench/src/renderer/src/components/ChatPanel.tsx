import { useRef, useEffect } from 'react'
import { MessageBubble } from './MessageBubble'
import { MessageQueue } from './MessageQueue'
import { InputArea } from './InputArea'
import { GSDResultCard } from './GSDResultCard'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  type?: 'text' | 'thinking' | 'toolCall' | 'error'
  timestamp: string
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

interface ChatPanelProps {
  messages: Message[]
  isGenerating: boolean
  onSend: (content: string, images?: Array<{ data: string; mimeType: string }>) => void
  onStop: () => void
  onNewChat: () => void
  currentWorkspace?: string
  queue?: QueuedMessage[]
  onQueueGuide?: (id: string) => void
  onQueueDelete?: (id: string) => void
  onGSDCommand?: (command: string, args: string) => void
  gsdCommands?: GSDCommand[]
  onQueueAdd?: (content: string) => void
}

export function ChatPanel({ messages, isGenerating, onSend, onStop, onNewChat, currentWorkspace, queue, onQueueGuide, onQueueDelete, onGSDCommand, gsdCommands, onQueueAdd }: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  // ── Empty state: centered input area as dialog ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-[#fafafa] dark:bg-[#171717]">
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-xl">
            <InputArea
              onSend={onSend}
              onStop={onStop}
              isGenerating={isGenerating}
              disabled={false}
              onGSDCommand={onGSDCommand}
              gsdCommands={gsdCommands}
              onQueueAdd={onQueueAdd}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Active state: messages + InputArea at bottom ──
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
              {(() => {
                try {
                  const parsed = JSON.parse(msg.content)
                  if (parsed.type === 'gsd') {
                    return (
                      <GSDResultCard
                        command={parsed.command}
                        success={parsed.success}
                        output={parsed.output}
                        error={parsed.error}
                      />
                    )
                  }
                } catch {}
                return <MessageBubble message={msg} />
              })()}
            </div>
          </div>
        ))}

        {/* "思考中..." animation when generating but no content yet */}
        {isGenerating && messages.filter(m => m.role === 'assistant').length === (messages[messages.length - 1]?.id === 'streaming' ? 1 : 0) && !messages.some(m => m.id === 'streaming') && (
          <div className="flex justify-start">
            <div className="max-w-[720px] bg-white dark:bg-[#1a1a1a] rounded-lg px-4 py-2">
              <span className="text-sm text-[#888] animate-pulse">思考中...</span>
            </div>
          </div>
        )}
      </div>

      {/* Message Queue */}
      {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
        <MessageQueue
          items={queue}
          onGuide={onQueueGuide}
          onDelete={onQueueDelete}
        />
      )}

      {/* Input area at bottom */}
      <InputArea
        onSend={onSend}
        onStop={onStop}
        isGenerating={isGenerating}
        disabled={false}
        onGSDCommand={onGSDCommand}
        gsdCommands={gsdCommands}
        onQueueAdd={onQueueAdd}
      />
    </div>
  )
}