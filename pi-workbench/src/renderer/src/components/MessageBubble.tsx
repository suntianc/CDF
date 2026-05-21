import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    streaming?: boolean
    status?: 'sending' | 'sent' | 'error'
  }
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.streaming === true

  return (
    <div
      className={cn(
        'flex w-full font-sans',
        isUser ? 'items-end justify-end' : 'items-start justify-start'
      )}
    >
      {isUser ? (
        // User bubble
        <div
          className={cn(
            'max-w-[80%] rounded-[10px] px-[14px] py-[10px]',
            'bg-[var(--accent)] text-white'
          )}
        >
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
            {message.content}
          </p>
        </div>
      ) : (
        // Assistant plain text
        <div
          className={cn(
            'max-w-full bg-transparent text-[var(--text-primary)]',
            isStreaming && 'animate-fadeUp'
          )}
        >
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap">
            {message.content}
            {isStreaming && (
              <span className="ml-1 inline-block animate-blink">▍</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
