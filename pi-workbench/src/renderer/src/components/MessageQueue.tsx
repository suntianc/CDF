import { useRef, useEffect } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronUp } from 'lucide-react'

interface QueuedMessage {
  id: string
  content: string
  createdAt: string
}

interface MessageQueueProps {
  items: QueuedMessage[]
  onGuide: (id: string) => void
  onDelete: (id: string) => void
}

export function MessageQueue({ items, onGuide, onDelete }: MessageQueueProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items.length])

  if (items.length === 0) return null

  return (
    <Collapsible defaultOpen className="border-t border-[#ebebeb] dark:border-[#2a2a2a]">
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-xs text-[#888]">
          有 {items.length} 条消息排队
        </span>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-xs text-[#888] hover:text-[#4d4d4d] transition-colors">
            <ChevronUp className="w-3.5 h-3.5 [&.chevron-up]:rotate-180 transition-transform duration-200" />
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div
          ref={scrollRef}
          className="max-h-[200px] overflow-y-auto px-4 pb-2 space-y-1.5"
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 bg-[#f5f5f5] dark:bg-[#252525] rounded-md border border-[#ebebeb] dark:border-[#2a2a2a] px-3 py-2"
            >
              {/* Message preview */}
              <span className="flex-1 text-[13px] leading-[18px] text-[#4d4d4d] dark:text-[#ebebeb] truncate min-w-0">
                {item.content.length > 50
                  ? item.content.slice(0, 50) + '...'
                  : item.content
                }
              </span>

              {/* Guide button — ↩︎ */}
              <button
                onClick={() => onGuide(item.id)}
                className="flex items-center justify-center w-6 h-6 rounded bg-white border border-[#ebebeb] dark:bg-[#1a1a1a] dark:border-[#2a2a2a] text-sm text-[#4d4d4d] hover:bg-[#fafafa] dark:hover:bg-[#333] transition-colors shrink-0"
                title="立即发送"
              >
                ↩︎
              </button>

              {/* Delete button — × */}
              <button
                onClick={() => onDelete(item.id)}
                className="flex items-center justify-center w-6 h-6 text-sm text-[#ee0000] hover:opacity-80 transition-opacity shrink-0"
                title="删除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}