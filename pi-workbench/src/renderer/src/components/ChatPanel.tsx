import { useRef, useEffect } from 'react'
import { MessageBubble } from './MessageBubble'
import { MessageQueue } from './MessageQueue'
import { InputArea } from './InputArea'
import { GSDResultCard } from './GSDResultCard'
import { Sparkles } from 'lucide-react'

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

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  // ── 1. 空白引导状态：实现完美的绝对水平垂直居中 ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 w-full h-full flex flex-col items-center justify-center bg-neutral-50/30 dark:bg-[#0a0a0c] px-6">
        <div className="w-full max-w-2xl flex flex-col items-center justify-center -translate-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="text-center mb-6 space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-white dark:bg-neutral-900 text-indigo-500 shadow-xs border border-neutral-200/50 dark:border-neutral-800">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <h2 className="text-lg font-medium tracking-tight text-neutral-800 dark:text-neutral-100">
              今天想构建什么系统？
            </h2>
          </div>
          <div className="w-full shadow-elevated rounded-2xl">
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

  // ── 2. 活跃对话状态 ──
  return (
    <div className="flex-1 h-full flex flex-col bg-white dark:bg-[#0b0b0b] relative min-w-0 overflow-hidden">
      {/* 消息滚动主区域 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 sm:px-8 pt-4 pb-36 space-y-8 no-scrollbar"
      >
        {/* 严格锁死消息流在中间的黄金可读区域 (max-w-2xl) */}
        <div className="max-w-2xl mx-auto w-full space-y-8 min-w-0">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} min-w-0`}
            >
              <div className="w-full min-w-0">
                {(() => {
                  try {
                    const parsed = JSON.parse(msg.content)
                    if (parsed.type === 'gsd') {
                      return (
                        <div className="my-2 shadow-xs min-w-0 overflow-hidden">
                          <GSDResultCard
                            command={parsed.command}
                            success={parsed.success}
                            output={parsed.output}
                            error={parsed.error}
                          />
                        </div>
                      )
                    }
                  } catch {}
                  return <MessageBubble message={msg} />
                })()}
              </div>
            </div>
          ))}

          {/* 打字机流式等待加载动画 */}
          {isGenerating && messages.filter(m => m.role === 'assistant').length === (messages[messages.length - 1]?.id === 'streaming' ? 1 : 0) && !messages.some(m => m.id === 'streaming') && (
            <div className="flex justify-start items-center gap-2 animate-pulse pl-1">
              <div className="flex space-x-1 items-center">
                <div className="w-1 h-1 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1 h-1 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1 h-1 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部悬浮式输入框与队列区容器：完美水平居中并控制宽度 */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#0b0b0b] dark:via-[#0b0b0b]/95 p-4 sm:p-6 pointer-events-none z-20">
        <div className="max-w-2xl mx-auto w-full pointer-events-auto space-y-3 min-w-0">
          
          {/* 排队消息队列 */}
          {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md shadow-lg overflow-hidden max-h-36 min-w-0">
              <MessageQueue
                items={queue}
                onGuide={onQueueGuide}
                onDelete={onQueueDelete}
              />
            </div>
          )}

          {/* 拟物浮雕效果的现代化输入区 */}
          <div className="shadow-lg border border-neutral-200/70 dark:border-neutral-800/80 rounded-2xl bg-white dark:bg-[#121212] focus-within:ring-1 focus-within:ring-neutral-400 dark:focus-within:ring-neutral-700 transition-all min-w-0">
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
    </div>
  )
}