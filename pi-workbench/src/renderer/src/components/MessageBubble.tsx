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

const STATUS_STYLES: Record<string, string> = {
  sending: 'text-amber-500 dark:text-amber-400',
  sent: 'text-emerald-500 dark:text-emerald-400',
  guided: 'text-blue-500 dark:text-blue-400',
  stopped: 'text-rose-500 dark:text-rose-400',
}

const STATUS_LABELS: Record<string, string> = {
  sending: '同步中',
  sent: '已就绪',
  guided: '已介入',
  stopped: '被拦截',
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex flex-col gap-1 w-full ${isUser ? 'items-end' : 'items-start'} group`}>
      
      {/* 气泡及文本外层容器 */}
      <div
        className={`
          text-[14px] leading-6 tracking-wide max-w-[85%] sm:max-w-[80%] font-sans
          ${isUser
            ? 'rounded-2xl px-4 py-2 bg-neutral-100 text-neutral-900 dark:bg-neutral-800/80 dark:text-neutral-100 shadow-xs'
            : 'w-full bg-transparent text-neutral-800 dark:text-neutral-200 px-0 py-1'
            /* AI 回复彻底无背景、无边框、纯文字融入主背景 */
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-normal">{message.content}</p>
        ) : (
          <div className="prose-custom w-full">
            <MarkdownRenderer content={message.content} />
          </div>
        )}
      </div>

      {/* 底部精细的时间与同步状态提示元信息 */}
      <div 
        className={`
          flex items-center gap-2 text-[11px] font-mono tracking-tight text-neutral-400 dark:text-neutral-500 
          opacity-0 group-hover:opacity-100 transition-opacity duration-200
          ${isUser ? 'pr-2' : 'pl-0'}
        `}
      >
        {isUser && message.status && (
          <span className={`font-medium ${STATUS_STYLES[message.status] || ''}`}>
            {STATUS_LABELS[message.status]}
          </span>
        )}
        <span>{message.timestamp}</span>
      </div>
    </div>
  )
}