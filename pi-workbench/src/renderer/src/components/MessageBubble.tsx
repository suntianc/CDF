import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ToolBlock {
  name: string
  args: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'sending' | 'sent' | 'guided' | 'stopped'
  timestamp: string
  thinking?: string
  tools?: ToolBlock[]
}

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isStreaming = !isUser && message.id === 'streaming'

  return (
    <div className={`flex flex-col w-full group font-sans ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`
          w-full text-[14px] leading-relaxed break-words
          ${isUser
            ? 'max-w-[85%] self-end rounded-2xl bg-[#f4f4f4] dark:bg-[#2f2f2f] px-4 py-2.5 text-neutral-900 dark:text-neutral-100'
            : 'max-w-full bg-transparent py-1 px-0 text-neutral-800 dark:text-neutral-200'
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-normal">{message.content}</p>
        ) : (
          <div className="w-full select-text space-y-1">
            {/* Thinking block (collapsible, shows reasoning) */}
            {message.thinking && (
              <ThinkingBlock
                content={message.thinking}
                isComplete={message.status === 'sent' || message.status === 'stopped'}
              />
            )}

            {/* Tool call blocks */}
            {message.tools && message.tools.length > 0 && (
              <div className="space-y-1 my-1">
                {message.tools.map((tool, idx) => (
                  <ToolCallCard
                    key={`${tool.name}-${idx}`}
                    name={tool.name}
                    args={tool.args}
                    status={tool.status}
                    result={tool.result}
                  />
                ))}
              </div>
            )}

            {/* Markdown text content */}
            {message.content && (
              <div className="prose-custom w-full">
                <MarkdownRenderer content={message.content} />
                {isStreaming && (
                  <span className="ml-1 inline-block animate-pulse text-neutral-400">▍</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover timestamp */}
      <div
        className={`
          mt-1 text-[10px] font-mono tracking-tight text-neutral-400 dark:text-neutral-500 opacity-0 transition-opacity duration-200 select-none group-hover:opacity-100
          ${isUser ? 'w-auto self-end pr-1' : 'w-full text-left pl-1'}
        `}
      >
        <span>{message.timestamp || '刚刚'}</span>
      </div>
    </div>
  )
}
