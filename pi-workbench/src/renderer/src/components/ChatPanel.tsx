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

  // ── 空白状态：精致的极简主义 Dialog ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-neutral-50 dark:bg-[#0b0b0b] transition-colors duration-300">
        <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-2xl mx-auto w-full">
          <div className="text-center mb-8 space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="inline-flex p-3 rounded-2xl bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 mb-2 shadow-sm">
              <Sparkles className="w-6 h-6 animate-pulse text-indigo-500" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              今天想构建什么系统？
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-md">
              输入消息直接开始对话，或者使用键盘触发 <code className="px-1.5 py-0.5 rounded font-mono bg-neutral-200 dark:bg-neutral-800 text-[11px]">/gsd-</code> 指令调度工程状态。
            </p>
          </div>
          <div className="w-full shadow-xl shadow-neutral-200/50 dark:shadow-none border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl bg-white dark:bg-[#121212] overflow-hidden">
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

  // ── 活跃对话状态 ──
  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-[#0b0b0b] transition-colors duration-300 relative">
      {/* 消息区域 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 pb-32 space-y-6 no-scrollbar"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-200`}
            >
              <div className="w-full max-w-2xl">
                {(() => {
                  try {
                    const parsed = JSON.parse(msg.content)
                    if (parsed.type === 'gsd') {
                      return (
                        <div className="my-2 shadow-sm">
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
              <span className="text-xs font-medium tracking-wide text-neutral-400 dark:text-neutral-500 font-sans">Agent 正在组织架构...</span>
            </div>
          )}
        </div>
      </div>

      {/* 底部悬浮式输入框与队列区容器 */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#0b0b0b] dark:via-[#0b0b0b]/95 p-4 md:p-6 pointer-events-none">
        <div className="max-w-3xl mx-auto w-full pointer-events-auto space-y-3">
          
          {/* 消息队列 */}
          {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md shadow-lg overflow-hidden max-h-36">
              <MessageQueue
                items={queue}
                onGuide={onQueueGuide}
                onDelete={onQueueDelete}
              />
            </div>
          )}

          {/* 拟物浮雕效果的现代化输入区 */}
          <div className="shadow-lg border border-neutral-200/70 dark:border-neutral-800/80 rounded-2xl bg-white dark:bg-[#121212] focus-within:ring-1 focus-within:ring-neutral-400 dark:focus-within:ring-neutral-700 transition-all">
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