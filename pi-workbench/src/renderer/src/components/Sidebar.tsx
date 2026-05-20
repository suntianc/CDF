import { Settings, Code2, Puzzle, Plus, FolderGit2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ConversationList } from './ConversationList'

interface NavItemProps {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  comingSoon?: boolean
  onClick?: () => void
}

function NavItem({ icon, label, active, disabled, comingSoon, onClick }: NavItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`
        flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] rounded-lg transition-all duration-200 font-sans
        ${disabled
          ? 'text-neutral-400 dark:text-neutral-600 cursor-not-allowed opacity-60'
          : active
            ? 'bg-neutral-200/60 text-neutral-900 font-medium dark:bg-neutral-800 dark:text-neutral-100 shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
            : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/30 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/40'
        }
      `}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-80">{icon}</span>
      <span className="flex-1 text-left tracking-wide">{label}</span>
      {comingSoon && (
        <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-md bg-neutral-200/50 text-neutral-500 scale-90 dark:bg-neutral-800/60 dark:text-neutral-400">
          Beta
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  activeNav: string
  onNavigate: (page: string) => void
  workspaces: Array<{ path: string; name: string }>
  onAddWorkspace: () => void
  onSwitchWorkspace: (path: string) => void
  conversations?: Array<{ id: string; name: string; createdAt: string }>
  activeConversationId?: string | null
  onSelectConversation?: (id: string) => void
  onNewConversation?: () => void
}

export function Sidebar({ activeNav, onNavigate, workspaces, onAddWorkspace, onSwitchWorkspace, conversations, activeConversationId, onSelectConversation, onNewConversation }: SidebarProps) {
  return (
    <aside className="w-[240px] h-full flex flex-col bg-[var(--sidebar)] border-r border-[var(--sidebar-border)] select-none">
      {/* macOS 交通灯区安全顶部占位 */}
      <div className="h-[38px] w-full shrink-0 window-drag-region" />

      {/* 优雅的主应用标志切换 */}
      <div className="px-3.5 py-2">
        <button
          onClick={() => onNavigate('welcome')}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold tracking-wider uppercase text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 rounded-lg transition-colors border border-transparent hover:border-neutral-200/40"
        >
          <div className="w-4 h-4 rounded bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center text-white dark:text-neutral-900 font-serif text-[10px] font-bold">π</div>
          <span>pi-workbench</span>
        </button>
      </div>

      {/* 历史对话（动态收纳区域） */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-2 space-y-4">
        <ConversationList
          conversations={conversations || []}
          activeId={activeConversationId || null}
          onSelect={onSelectConversation || (() => {})}
          onNew={onNewConversation || (() => {})}
        />

        {/* 核心工作流菜单栏 */}
        <div className="px-3.5 space-y-0.5">
          <span className="px-2.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider block mb-1.5">核心组件</span>
          <NavItem
            icon={<Code2 className="w-4 h-4" />}
            label="Skills"
            disabled
            comingSoon
          />
          <NavItem
            icon={<Puzzle className="w-4 h-4" />}
            label="MCP Market"
            disabled
            comingSoon
          />
          <NavItem
            icon={<Settings className="w-4 h-4" />}
            label="偏好设置"
            active={activeNav === 'settings'}
            onClick={() => onNavigate('settings')}
          />
        </div>

        {/* 分割线 */}
        <div className="mx-6 border-t border-neutral-200/40 dark:border-neutral-800/40" />

        {/* 工作区容器 */}
        <div className="px-3.5 space-y-1">
          <div className="flex items-center justify-between px-2.5 mb-1">
            <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">本地工作区</span>
            <button
              onClick={onAddWorkspace}
              className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 transition-colors"
              title="添加工作区"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-0.5">
            {workspaces.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[11px] text-neutral-400 italic">尚未加入工作目录</p>
            ) : (
              workspaces.map((ws) => {
                const isActive = workspaces[0]?.path === ws.path
                return (
                  <button
                    key={ws.path}
                    onClick={() => onSwitchWorkspace(ws.path)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-lg transition-all truncate text-left
                      ${isActive
                        ? 'text-neutral-900 font-medium dark:text-neutral-100 bg-neutral-200/30 dark:bg-neutral-800/30'
                        : 'text-neutral-500 hover:bg-neutral-200/20 dark:text-neutral-400 dark:hover:bg-neutral-800/20'
                      }`}
                  >
                    <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                    <span className="truncate">{ws.name}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}