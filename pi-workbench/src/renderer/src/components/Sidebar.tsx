import { useState } from 'react'
import {
  Plus, Settings, FolderGit2, Trash2,
  ChevronDown, ChevronRight, SquarePen, Search, Blocks, Cpu, Smartphone
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Workspace {
  path: string
  name: string
}

interface Conversation {
  id: string
  name: string
  createdAt: string
}

interface SidebarProps {
  activeNav: string
  onNavigate: (page: string) => void
  workspaces: Workspace[]
  onAddWorkspace: () => void
  onSwitchWorkspace: (path: string) => void
  conversations?: Conversation[]
  activeConversationId?: string | null
  onSelectConversation?: (id: string) => void
  onNewConversation?: () => void
  onDeleteConversation?: (id: string) => void
}

// 辅助函数：格式化类似参考图的"时间标签"
function formatTimeTag(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 60) return `${Math.max(1, diffMins)} 分钟`
    if (diffHours < 24) return `${diffHours} 小时`
    return `${diffDays} 天`
  } catch {
    return '刚刚'
  }
}

export function Sidebar({
  activeNav,
  onNavigate,
  workspaces,
  onAddWorkspace,
  onSwitchWorkspace,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation
}: SidebarProps) {
  // 控制各个项目文件夹的展开/收起状态，默认第一个展开
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({
    [workspaces[0]?.path]: true
  })

  const toggleWorkspace = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedWorkspaces(prev => ({ ...prev, [path]: !prev[path] }))
  }

  return (
    <aside className="w-[260px] h-full flex flex-col bg-[#e3e3e3]/70 dark:bg-[#16161a] border-r border-neutral-200/40 dark:border-neutral-800/40 select-none">
      {/* 交通灯区安全顶部占位 */}
      <div className="h-[34px] w-full shrink-0 window-drag-region" />

      {/* ── 1. 顶部全局高频动作控制链 ── */}
      <div className="px-3 py-2 space-y-0.5">
        <button
          onClick={onNewConversation}
          className="flex items-center gap-3 w-full px-2.5 py-2 text-[13px] font-normal text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors cursor-pointer"
        >
          <SquarePen className="w-4 h-4 opacity-80 text-neutral-500" />
          <span>新对话</span>
        </button>
        <button className="flex items-center gap-3 w-full px-2.5 py-2 text-[13px] font-normal text-neutral-400 dark:text-neutral-600 cursor-not-allowed opacity-60">
          <Search className="w-4 h-4 opacity-80" />
          <span>搜索</span>
        </button>
        <button className="flex items-center gap-3 w-full px-2.5 py-2 text-[13px] font-normal text-neutral-400 dark:text-neutral-600 cursor-not-allowed opacity-60">
          <Blocks className="w-4 h-4 opacity-80" />
          <span>插件</span>
        </button>
        <button className="flex items-center gap-3 w-full px-2.5 py-2 text-[13px] font-normal text-neutral-400 dark:text-neutral-600 cursor-not-allowed opacity-60">
          <Cpu className="w-4 h-4 opacity-80" />
          <span>自动化</span>
        </button>
      </div>

      {/* ── 2. 项目与会话树状核心区 ── */}
      <div className="flex-1 overflow-hidden flex flex-col mt-2">
        <div className="flex items-center justify-between px-5 mb-1.5 shrink-0">
          <span className="text-[11px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
            项目
          </span>
          <button
            onClick={onAddWorkspace}
            className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer"
            title="添加项目"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>

        <ScrollArea className="flex-1 px-3">
          <div className="space-y-1 pb-4">
            {workspaces.length === 0 ? (
              <p className="px-3 py-2 text-xs text-neutral-400 italic">尚未加入工作目录</p>
            ) : (
              workspaces.map((ws) => {
                const isCurrentWs = workspaces[0]?.path === ws.path // 排在第一位的是激活的
                const isOpen = !!expandedWorkspaces[ws.path]

                return (
                  <div key={ws.path} className="flex flex-col">
                    {/* 文件夹头部行 */}
                    <div
                      onClick={() => onSwitchWorkspace(ws.path)}
                      className={`group/ws flex items-center justify-between w-full px-2 py-1.5 rounded-lg text-[13px] cursor-pointer transition-all
                        ${isCurrentWs
                          ? 'text-neutral-900 font-medium dark:text-neutral-200'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/30 dark:hover:bg-neutral-800/30'
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* 折叠小箭头 */}
                        <button
                          onClick={(e) => toggleWorkspace(ws.path, e)}
                          className="p-0.5 rounded hover:bg-neutral-300/40 dark:hover:bg-neutral-700/40 text-neutral-400"
                        >
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isCurrentWs ? 'text-indigo-500' : 'text-neutral-400'}`} />
                        <span className="truncate tracking-wide">{ws.name}</span>
                      </div>
                    </div>

                    {/* 📁 内嵌的子会话列表（卡片展开体系） */}
                    {isOpen && (
                      <div className="ml-4 pl-2 border-l border-neutral-300/40 dark:border-neutral-800/60 mt-0.5 space-y-0.5">
                        {isCurrentWs && conversations.length > 0 ? (
                          conversations.map((conv) => {
                            const isChatActive = conv.id === activeConversationId
                            return (
                              <div
                                key={conv.id}
                                onClick={() => onSelectConversation?.(conv.id)}
                                className={`group/item relative flex items-center justify-between w-full rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-all duration-150
                                  ${isChatActive
                                    ? 'bg-neutral-200/80 text-neutral-900 font-medium dark:bg-neutral-800 dark:text-neutral-100 shadow-xs'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 hover:text-neutral-900 dark:hover:text-neutral-200'
                                  }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-12 flex-1">
                                  <span className="truncate tracking-wide">{conv.name}</span>
                                </div>

                                {/* 右侧时间标签（静止态可见） */}
                                <span className="text-[10px] font-mono text-neutral-400 shrink-0 group-hover/item:opacity-0 transition-opacity">
                                  {formatTimeTag(conv.createdAt)}
                                </span>

                                {/* 悬浮呼出物理删除 */}
                                {onDeleteConversation && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (confirm(`确定删除对话 "${conv.name}" 吗？`)) {
                                        onDeleteConversation(conv.id)
                                      }
                                    }}
                                    className="absolute right-1.5 opacity-0 group-hover/item:opacity-100 p-1 rounded text-neutral-400 hover:text-rose-500 hover:bg-neutral-300/50 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )
                          })
                        ) : isCurrentWs ? (
                          <p className="px-2 py-1.5 text-[11px] text-neutral-400 italic">暂无聊天</p>
                        ) : (
                          <p className="px-2 py-1.5 text-[11px] text-neutral-400/60 italic">点击激活工作区查看</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── 3. 独立出来的底部低频对话标签与设置 ── */}
      <div className="mt-auto shrink-0 border-t border-neutral-200/40 dark:border-neutral-800/40 bg-neutral-200/20 dark:bg-neutral-900/10">
        {/* 保留原本的普通独立会话兜底 */}
        {conversations.length === 0 && (
          <div className="px-5 py-2.5 select-none">
            <span className="text-[11px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider block mb-1">对话</span>
            <span className="text-xs text-neutral-400 italic">暂无聊天</span>
          </div>
        )}

        <div className="px-3.5 py-2 flex items-center justify-between">
          <button
            onClick={() => onNavigate('settings')}
            className={`flex items-center gap-2.5 px-2.5 py-2 text-[13px] rounded-lg transition-all w-full text-left font-sans cursor-pointer
              ${activeNav === 'settings'
                ? 'bg-neutral-200/60 text-neutral-900 font-medium dark:bg-neutral-800'
                : 'text-neutral-600 hover:bg-neutral-200/30 dark:text-neutral-400 dark:hover:bg-neutral-800/40 hover:text-neutral-900'
              }`}
          >
            <Settings className="w-4 h-4 opacity-80" />
            <span className="flex-1">设置</span>
          </button>

          {/* 右下角小手机图标 */}
          <div className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors shrink-0">
            <Smartphone className="w-3.5 h-3.5 opacity-60" />
          </div>
        </div>
      </div>
    </aside>
  )
}
