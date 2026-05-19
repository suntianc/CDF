import { Settings, Code2, Puzzle, Plus, MessageSquare } from 'lucide-react'
import type { ReactNode } from 'react'

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
        flex items-center gap-3 w-full px-3 py-1.5 text-sm rounded-sm transition-colors
        ${disabled
          ? 'text-[#888888] cursor-not-allowed'
          : active
            ? 'bg-[#f5f5f5] text-[#171717] font-medium dark:bg-[#252525] dark:text-white'
            : 'text-[#4d4d4d] hover:bg-[#f5f5f5] dark:text-[#888] dark:hover:bg-[#252525]'
        }
      `}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {comingSoon && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f5f5f5] text-[#888] dark:bg-[#252525]">
          即将推出
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
}

export function Sidebar({ activeNav, onNavigate, workspaces, onAddWorkspace, onSwitchWorkspace }: SidebarProps) {
  return (
    <aside className="w-[256px] h-full flex flex-col bg-white dark:bg-[#1a1a1a] border-r border-[#ebebeb] dark:border-[#2a2a2a] shadow-sidebar select-none">
      {/* macOS traffic light spacer */}
      <div className="h-[38px] w-full shrink-0" />
      {/* App title - click to go home */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => onNavigate('welcome')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#171717] dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#252525] rounded-[6px] transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>pi-workbench</span>
        </button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 space-y-0.5">
        <NavItem
          icon={<Code2 className="w-4 h-4" />}
          label="Skills"
          disabled
          comingSoon
        />
        <NavItem
          icon={<Puzzle className="w-4 h-4" />}
          label="MCP"
          disabled
          comingSoon
        />
        <NavItem
          icon={<Settings className="w-4 h-4" />}
          label="设置"
          active={activeNav === 'settings'}
          onClick={() => onNavigate('settings')}
        />

        {/* Divider */}
        <div className="my-2 border-t border-[#ebebeb] dark:border-[#2a2a2a]" />

        {/* Workspace Section */}
        <div className="flex items-center justify-between px-1 py-1">
          <span className="text-xs font-medium text-[#888] uppercase tracking-wide">工作区</span>
          <button
            onClick={onAddWorkspace}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] dark:hover:bg-[#252525] text-[#888] transition-colors"
            title="添加工作区"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Workspace List */}
        <div className="space-y-0.5">
          {workspaces.length === 0 ? (
            <p className="px-2 py-2 text-xs text-[#888]">尚未添加工作区</p>
          ) : (
            workspaces.map((ws) => (
              <button
                key={ws.path}
                onClick={() => onSwitchWorkspace(ws.path)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#4d4d4d] hover:bg-[#f5f5f5] dark:hover:bg-[#252525] rounded-[6px] transition-colors truncate"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#ebebeb] shrink-0" />
                {ws.name}
              </button>
            ))
          )}
        </div>
      </nav>
    </aside>
  )
}