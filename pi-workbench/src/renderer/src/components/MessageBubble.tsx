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
    <div className={`flex flex-col w-full ${isUser ? 'items-end' : 'items-start'} group font-sans`}>
      
      {/* 核心气泡控制层 */}
      <div
        className={`
          text-[14px] leading-relaxed break-words tracking-wide w-full
          ${isUser
            ? 'max-w-[80%] rounded-2xl px-4 py-2 bg-neutral-100 text-neutral-900 dark:bg-neutral-800/70 dark:text-neutral-100 shadow-2xs self-end text-left'
            : 'max-w-full bg-transparent text-neutral-800 dark:text-neutral-200 py-1 px-0'
            /* AI 内容彻底回归原始，剥离背景色块与多余间距线 */
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

      {/* 微型时间戳（仅在鼠标悬停在这一行消息时精致显现，防止画面杂乱） */}
      <div 
        className={`
          text-[10px] font-mono tracking-tight text-neutral-400 dark:text-neutral-500 mt-1
          opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none
          ${isUser ? 'pr-2' : 'pl-0'}
        `}
      >
        <span>{message.timestamp || '刚刚'}</span>
      </div>
    </div>
  )
}