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

  // ── 1. 空白状态响应式：根据页面高度与宽度自动收缩内边距 ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-neutral-50/50 dark:bg-[#0a0a0c] transition-colors duration-300 min-w-0 overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 max-w-xl mx-auto w-full transition-all">
          <div className="text-center mb-6 space-y-2">
            <div className="inline-flex p-2.5 rounded-xl bg-white dark:bg-neutral-900 text-indigo-500 shadow-sm border border-neutral-100 dark:border-neutral-800">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <h2 className="text-base sm:text-lg font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
              今天想构建什么系统？
            </h2>
          </div>
          <div className="w-full shadow-elevated rounded-xl">
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

  // ── 2. 活跃对话状态响应式 ──
  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#0b0b0b] transition-colors duration-300 relative min-w-0 h-full">
      {/* 消息历史滚动区 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-4 pb-36 space-y-6 no-scrollbar min-w-0"
      >
        {/* max-w-3xl 在大屏幕下聚合，w-full 配合 min-w-0 保证缩小时贴合边缘 */}
        <div className="max-w-3xl mx-auto w-full min-w-0 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-200 min-w-0`}
            >
              {/* 控制单条消息的最大自适应宽度 */}
              <div className="w-full max-w-[92%] sm:max-w-2xl min-w-0">
                {(() => {
                  try {
                    const parsed = JSON.parse(msg.content)
                    if (parsed.type === 'gsd') {
                      return (
                        <div className="my-2 shadow-sm min-w-0 overflow-hidden">
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

          {/* 流式等待态 */}
          {isGenerating && messages.filter(m => m.role === 'assistant').length === (messages[messages.length - 1]?.id === 'streaming' ? 1 : 0) && !messages.some(m => m.id === 'streaming') && (
            <div className="flex justify-start items-center gap-3 animate-pulse pl-2">
              <div className="flex space-x-1.5 items-center">
                <div className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-600 rounded-full animate-bounce"></div>
              </div>
              <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500 font-sans">Agent 正在组织架构...</span>
            </div>
          )}
        </div>
      </div>

      {/* 底部悬浮容器：随屏幕大小自适应宽度并牢牢锚定 */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#0b0b0b] dark:via-[#0b0b0b]/95 p-4 sm:p-6 pointer-events-none min-w-0 z-20">
        <div className="max-w-3xl mx-auto w-full pointer-events-auto space-y-3 min-w-0">
          
          {/* 消息队列自适应 */}
          {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md shadow-lg overflow-hidden max-h-36 min-w-0">
              <MessageQueue
                items={queue}
                onGuide={onQueueGuide}
                onDelete={onQueueDelete}
              />
            </div>
          )}

          {/* 输入核心框 */}
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