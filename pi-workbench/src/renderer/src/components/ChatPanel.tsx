import { useEffect, useRef } from 'react'
import { useMessageStore } from '@/stores/messageStore'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { WelcomeDialog } from './WelcomeDialog'

interface ChatPanelProps {
  onSend: (content: string) => void
  onStop: () => void
  onNewChat: () => void
  currentWorkspace?: string
}

export function ChatPanel({ onSend, onStop, onNewChat, currentWorkspace }: ChatPanelProps) {
  const messages = useMessageStore((state) => state.messages)
  const isStreaming = useMessageStore((state) => state.isStreaming)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const hasMessages = messages.length > 0
  const isLoading = isStreaming && (messages.length === 0 || messages.at(-1)?.role === 'user')

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Messages list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-6 py-4"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="flex flex-col gap-1 max-w-[780px] mx-auto">
          {hasMessages ? (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          ) : (
            <WelcomeDialog
              onNewChat={onNewChat}
              hasWorkspace={!!currentWorkspace}
            />
          )}

          {isLoading && (
            <div className="animate-fadeUp text-[14px] text-[var(--text-secondary)] px-3 py-2">
              思考中...
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <InputArea
        onSend={onSend}
        onStop={onStop}
        disabled={isStreaming}
        placeholder="向 CDF 提问……"
      />
    </div>
  )
}
