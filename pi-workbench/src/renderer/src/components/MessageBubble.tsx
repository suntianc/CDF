import { MarkdownRenderer } from './MarkdownRenderer'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  timestamp: string
}

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className="flex flex-col w-full items-center justify-center group font-sans">
      <div
        className={`
          text-[14px] leading-relaxed break-words tracking-wide w-full
          ${isUser
            ? 'rounded-xl px-4 py-2.5 bg-neutral-200/40 text-neutral-900 dark:bg-neutral-800/50 dark:text-neutral-100 border border-neutral-200/20 dark:border-neutral-800/20 text-left'
            : 'bg-transparent text-neutral-800 dark:text-neutral-200 py-1 px-0 text-left'
            /* AI 内容彻底回归无边界印刷感 */
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-normal">{message.content}</p>
        ) : (
          <div className="prose-custom w-full select-text">
            <MarkdownRenderer content={message.content} />
          </div>
        )}
      </div>

      {/* 微型悬停提示线 */}
      <div className="text-[10px] font-mono tracking-tight text-neutral-400 dark:text-neutral-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none w-full text-left pl-1">
        <span>{message.timestamp || '刚刚'}</span>
      </div>
    </div>
  )
}