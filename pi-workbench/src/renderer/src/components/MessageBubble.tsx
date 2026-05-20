import { MarkdownRenderer } from './MarkdownRenderer'
import { User, Bot } from 'lucide-react'

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
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} group w-full`}>
      <div className={`flex gap-3 max-w-full ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* 精致的微型角色 Icon 标志 */}
        <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 text-xs shadow-sm select-none
          ${isUser 
            ? 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400' 
            : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400'
          }`}
        >
          {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
        </div>

        {/* 气泡本体 */}
        <div
          className={`
            text-[14px] leading-6 break-words tracking-wide
            ${isUser
              ? 'rounded-2xl rounded-tr-sm px-4 py-2 bg-neutral-100 text-neutral-900 dark:bg-neutral-800/80 dark:text-neutral-100 shadow-sm'
              : 'px-1 py-0.5 text-neutral-800 dark:text-neutral-200 w-full'
            }
          `}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap font-sans font-normal">{message.content}</p>
          ) : (
            <div className="prose-custom">
              <MarkdownRenderer content={message.content} />
            </div>
          )}
        </div>
      </div>

      {/* 元信息面板 */}
      <div className={`flex items-center gap-2 px-10 text-[11px] font-mono tracking-tight text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
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