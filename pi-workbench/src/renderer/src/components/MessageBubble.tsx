import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
  sending: 'text-[#f59e0b]',     // warning amber
  sent: 'text-[#16a34a]',        // success green
  guided: 'text-[#0070f3]',       // info blue
  stopped: 'text-[#ee0000]',      // destructive red
}

const STATUS_LABELS: Record<string, string> = {
  sending: '发送中',
  sent: '已发送',
  guided: '已引导',
  stopped: '已停止',
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className="flex flex-col gap-1">
  {/* Bubble content */}
      <div
        className={`
          rounded-lg px-4 py-2
          ${isUser
            ? 'bg-[#171717] text-white dark:bg-white dark:text-[#171717]'
            : 'bg-white text-[#4d4d4d] dark:bg-[#1a1a1a] dark:text-[#ebebeb]'
          }
        `}
      >
        {isUser ? (
          <p className="text-sm leading-5 whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>

      {/* Status tag (user messages only) + timestamp */}
      <div className={`flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'} px-1`}>
        {isUser && message.status && (
          <span className={`text-[11px] leading-[14px] ${STATUS_STYLES[message.status] || ''}`}>
            {STATUS_LABELS[message.status]}
          </span>
        )}
        <span className="text-[11px] leading-[14px] text-[#888888]">
          {message.timestamp}
        </span>
      </div>
    </div>
  )
}