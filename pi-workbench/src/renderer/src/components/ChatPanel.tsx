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

  // ── 1. 空状态：全响应式自动居中引导页 ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-neutral-50/50 dark:bg-[#0a0a0c] transition-colors duration-300 min-w-0 h-full overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-12 max-w-xl mx-auto w-full">
          <div className="text-center mb-6 space-y-2 shrink-0">
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

  // ── 2. 活跃聊天状态：带有呼吸安全边距的自适应滚动容器 ──
  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#0b0b0b] transition-colors duration-300 relative min-w-0 h-full overflow-hidden">
      {/* 消息流主视口 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-8 pt-4 pb-36 space-y-6 no-scrollbar min-w-0"
      >
        <div className="max-w-3xl mx-auto w-full min-w-0 space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} min-w-0`}
            >
              {/* 控制单条消息在大屏和小屏下的响应式分配比例 */}
              <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-2xl min-w-0">
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

          {/* 细腻的流式等待加载动画 */}
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

      {/* 底部悬浮控制台组件：永远贴合主舞台底部，并完美分配横向宽度 */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#0b0b0b] dark:via-[#0b0b0b]/95 p-3 sm:p-6 pointer-events-none min-w-0 z-20">
        <div className="max-w-3xl mx-auto w-full pointer-events-auto space-y-3 min-w-0">
          
          {/* 消息排队队列响应式限制 */}
          {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md shadow-lg overflow-hidden max-h-36 min-w-0">
              <MessageQueue
                items={queue}
                onGuide={onQueueGuide}
                onDelete={onQueueDelete}
              />
            </div>
          )}

          {/* 现代化流线输入框容器 */}
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