import { MessageSquare, Plus } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Conversation {
  id: string
  name: string
  createdAt: string
}

interface ConversationListProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConversationList({ conversations, activeId, onSelect, onNew }: ConversationListProps) {
  const DISPLAY_LIMIT = 10
  const visibleItems = conversations.slice(0, DISPLAY_LIMIT)
  const hasMore = conversations.length > DISPLAY_LIMIT

  return (
    <div className="px-3 py-2">
      {/* Header + New button */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[#888] uppercase tracking-wide">对话历史</span>
        <button
          onClick={onNew}
          className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] dark:hover:bg-[#252525] text-[#888] transition-colors"
          title="新建对话"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Conversation list (scrollable) */}
      {conversations.length === 0 ? (
        <p className="px-2 py-2 text-xs text-[#888]">暂无对话</p>
      ) : (
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-0.5">
            {visibleItems.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`
                  w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-[6px] transition-colors truncate
                  ${conv.id === activeId
                    ? 'bg-[#f5f5f5] text-[#171717] font-medium dark:bg-[#252525] dark:text-white'
                    : 'text-[#4d4d4d] hover:bg-[#f5f5f5] dark:text-[#888] dark:hover:bg-[#252525]'
                  }
                `}
              >
                <MessageSquare className="w-3 h-3 shrink-0" />
                <span className="truncate">{conv.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* "Show more" button */}
      {hasMore && (
        <button className="w-full text-xs text-[#0070f3] hover:text-[#0052cc] px-2 py-1 mt-1 text-left transition-colors">
          查看更多
        </button>
      )}
    </div>
  )
}