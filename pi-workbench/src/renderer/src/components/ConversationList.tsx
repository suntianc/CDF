import { useEffect, useState } from 'react'
import { Plus, MessageSquare, TrashIcon } from 'lucide-react'

export interface ConversationMeta {
  id: string
  path: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface ConversationListProps {
  workspacePath: string
  activeConversationId: string | null
  onSelectConversation: (id: string, path: string) => void
  onNewConversation: () => void
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString('zh-CN')
}

export function ConversationList({
  workspacePath,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    loadConversations()
  }, [workspacePath])

  const loadConversations = async () => {
    if (!window.api?.chatHistory) return
    setLoading(true)
    try {
      const list = await window.api.chatHistory.list(workspacePath)
      setConversations(list)
    } catch (err) {
      console.error('Failed to load conversations:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (conv: ConversationMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    if (showDeleteConfirm === conv.id) {
      // Confirm delete
      try {
        await window.api.chatHistory.delete(conv.path)
        await loadConversations()
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
      setShowDeleteConfirm(null)
    } else {
      setShowDeleteConfirm(conv.id)
    }
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* New conversation button */}
      <button
        onClick={onNewConversation}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Plus className="w-4 h-4" />
        新对话
      </button>

      {/* Loading state */}
      {loading && (
        <div className="text-[12px] text-[var(--text-muted)] px-3 py-2">
          加载中...
        </div>
      )}

      {/* Conversation list */}
      {!loading && conversations.length === 0 && (
        <div className="text-[12px] text-[var(--text-muted)] px-3 py-2">
          暂无对话
        </div>
      )}

      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={`group relative flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${
            conv.id === activeConversationId
              ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]'
              : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
          }`}
          onClick={() => onSelectConversation(conv.id, conv.path)}
        >
          <MessageSquare className="w-4 h-4 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] truncate">{conv.name}</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              {formatRelativeTime(conv.updatedAt)}
            </div>
          </div>

          {/* Delete button */}
          <button
            onClick={(e) => handleDelete(conv, e)}
            className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${
              showDeleteConfirm === conv.id
                ? 'opacity-100 bg-[var(--danger-dim)]'
                : 'hover:bg-[var(--danger-dim)]'
            }`}
          >
            <TrashIcon className="w-3 h-3 text-[var(--danger)]" />
          </button>
        </div>
      ))}

      {/* Inline delete confirmation */}
      {showDeleteConfirm && (
        <div className="px-3 py-2 text-[12px] text-[var(--text-secondary)] bg-[var(--bg-surface)] rounded-md mx-1">
          <span>确定删除？</span>
          <div className="flex gap-2 mt-1">
            <button
              onClick={(e) => {
                const conv = conversations.find((c) => c.id === showDeleteConfirm)
                if (conv) handleDelete(conv, e)
              }}
              className="text-[var(--danger)] hover:underline"
            >
              删除
            </button>
            <button
              onClick={() => setShowDeleteConfirm(null)}
              className="text-[var(--text-muted)] hover:underline"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
