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

export function ChatPanel({ messages, isGenerating, onSend, onStop, currentWorkspace, queue, onQueueGuide, onQueueDelete, onGSDCommand, gsdCommands, onQueueAdd }: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  // ── 1. 空状态：严格的中央限定宽度聚合（100% 对齐 Codex） ──
  if (messages.length === 0) {
    return (
      <div className="flex-1 w-full h-full flex flex-col items-center justify-center bg-transparent px-6">
        <div className="w-full max-w-2xl flex flex-col items-center -translate-y-8 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="text-center mb-6 space-y-2">
            <h2 className="text-xl font-medium tracking-tight text-neutral-800 dark:text-neutral-200">
              我们该在 {currentWorkspace?.split('/').pop() || '工作区'} 中做什么？
            </h2>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              可向 pi-workbench 询问任何事。输入消息开始，或键入命令。
            </p>
          </div>
          <div className="w-full">
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

  // ── 2. 活跃聊天状态：标准的瀑布垂直单列流布局 ──
  return (
    <div className="flex-1 w-full h-full flex flex-col bg-transparent relative min-w-0 overflow-hidden">
      {/* 消息流主体滚动区 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 sm:px-8 pt-2 pb-36 space-y-6 no-scrollbar min-w-0"
      >
        {/* 锁定整条聊天线最大宽度为 2xl (同 Codex 一致的黄金视距) */}
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6 min-w-0">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} min-w-0`}
            >
              <div className="w-full min-w-0">
                {(() => {
                  try {
                    const parsed = JSON.parse(msg.content)
                    if (parsed.type === 'gsd') {
                      return (
                        <div className="my-2 min-w-0 w-full overflow-hidden">
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

          {/* 打字机流式传输时微微的加载闪烁点 */}
          {isGenerating && messages.filter(m => m.role === 'assistant').length === (messages[messages.length - 1]?.id === 'streaming' ? 1 : 0) && !messages.some(m => m.id === 'streaming') && (
            <div className="flex justify-start items-center pl-1 animate-pulse">
              <div className="flex space-x-1 items-center">
                <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部悬浮控制台组件：永远锚定中央 */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#0a0a0c] dark:via-[#0a0a0c]/95 p-4 sm:p-6 pointer-events-none z-20">
        <div className="max-w-2xl mx-auto w-full pointer-events-auto space-y-3 min-w-0">
          {queue && onQueueGuide && onQueueDelete && queue.length > 0 && (
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg overflow-hidden max-h-32 min-w-0">
              <MessageQueue items={queue} onGuide={onQueueGuide} onDelete={onQueueDelete} />
            </div>
          )}
          <div className="rounded-xl bg-white dark:bg-[#111115] transition-all min-w-0">
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