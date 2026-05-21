import { useEffect, useRef, useState } from 'react'
import { useMessageStore } from '@/stores/messageStore'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { WelcomeDialog } from './WelcomeDialog'

interface ChatPanelProps {
  // Existing props from PiRuntimeProvider context
  isActiveStage?: boolean
  workspaceName?: string
  conversationName?: string
  contextPanelOpen?: boolean
  onToggleContextPanel?: () => void
  onOpenSettings?: () => void
  gitContext?: {
    available: boolean
    branch: string
    changedFiles: number
    stagedFiles: number
    ahead: number
    behind: number
    lastCommit: string
  }
  workflowContext?: {
    available: boolean
    workflowCount: number
    currentPhase: string
    status: string
    phaseSummary: string
  }
  // Chat panel specific props
  onSend?: (content: string) => void
  onStop?: () => void
  onNewChat?: () => void
  onClear?: () => void
  currentWorkspace?: string
}

export function ChatPanel({
  isActiveStage,
  workspaceName,
  conversationName,
  contextPanelOpen,
  onToggleContextPanel,
  onOpenSettings,
  gitContext,
  workflowContext,
  onSend,
  onStop,
  onNewChat,
  onClear,
  currentWorkspace,
}: ChatPanelProps) {
  const messages = useMessageStore((state) => state.messages)
  const isStreaming = useMessageStore((state) => state.isStreaming)
  const listRef = useRef<HTMLDivElement>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const hasMessages = messages.length > 0
  const isLoading = isStreaming && (messages.length === 0 || messages.at(-1)?.role === 'user')

  const handleClear = () => {
    if (onClear) {
      onClear()
    }
    setShowClearConfirm(false)
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Header with clear button */}
      {messages.length > 0 && (
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
          <span className="text-[14px] text-[var(--text-secondary)]">
            {messages.length} 条消息
          </span>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="text-[12px] text-[var(--danger)] hover:underline"
          >
            清空对话
          </button>
        </div>
      )}

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
        onSend={onSend || (() => {})}
        onStop={onStop || (() => {})}
        disabled={isStreaming}
        placeholder="向 CDF 提问……"
      />

      {/* Clear confirmation dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-surface)] rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-[16px] font-semibold mb-2">清空对话</h3>
            <p className="text-[14px] text-[var(--text-secondary)] mb-4">
              确定要清空当前对话吗？此操作不可撤销。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-[14px] rounded-md border border-[var(--border)] hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 text-[14px] rounded-md bg-[var(--danger)] text-white hover:opacity-90"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
