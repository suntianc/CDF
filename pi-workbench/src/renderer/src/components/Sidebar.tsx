import type { ReactNode } from 'react'
import {
  Blocks,
  Cpu,
  FolderGit2,
  Moon,
  Plus,
  Search,
  Settings,
  SunMedium,
  Workflow,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTheme } from '../hooks/useTheme'

interface Workspace {
  path: string
  name: string
}

interface Conversation {
  id: string
  path: string
  name: string
  createdAt: string
}

interface SidebarProps {
  activeNav: string
  onNavigate: (page: string) => void
  workspaces: Workspace[]
  activeWorkspace?: string | null
  onAddWorkspace: () => void
  onSwitchWorkspace: (path: string) => void
  conversations?: Conversation[]
  activeConversationId?: string | null
  onSelectConversation?: (id: string, path: string) => void
  onNewConversation?: () => void
}

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

function SectionTitle({
  label,
  action,
}: {
  label: string
  action?: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center justify-between px-5">
      <span className="text-[12px] font-semibold tracking-wide text-sidebar-foreground/20">{label}</span>
      {action}
    </div>
  )
}

export function Sidebar({
  activeNav,
  onNavigate,
  workspaces,
  activeWorkspace,
  onAddWorkspace,
  onSwitchWorkspace,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}: SidebarProps) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <aside className="flex h-full w-[432px] shrink-0 flex-col border-r border-white/6 bg-[#1c1c1c] text-sidebar-foreground select-none">
      <div className="h-[34px] w-full shrink-0 window-drag-region" />

      <div className="px-6 py-7 space-y-2">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium text-sidebar-foreground/88 transition-colors hover:bg-white/6 cursor-pointer"
        >
          <Plus className="h-4 w-4 text-sidebar-foreground/34" />
          <span>新建对话</span>
        </button>

        <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sidebar-foreground/44 transition-colors hover:bg-white/6">
          <Search className="h-4 w-4 opacity-80" />
          <span className="text-[14px]">搜索</span>
        </div>

        <div className="grid grid-cols-2 gap-3 px-0 pt-3">
          <button
            type="button"
            className="flex items-center justify-center gap-2 rounded-[20px] border border-white/8 px-4 py-3 text-[12px] font-medium text-sidebar-foreground/44 transition-colors hover:bg-white/6"
          >
            <Blocks className="h-4 w-4" />
            <span>插件管理</span>
          </button>
          <button
            type="button"
            className="flex items-center justify-center gap-2 rounded-[20px] border border-white/8 px-4 py-3 text-[12px] font-medium text-sidebar-foreground/44 transition-colors hover:bg-white/6"
          >
            <Workflow className="h-4 w-4" />
            <span>工作流管理</span>
          </button>
        </div>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-7 pb-8">
            <section>
              <SectionTitle
                label="项目列表"
                action={
                  <button
                    type="button"
                    onClick={onAddWorkspace}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md text-sidebar-foreground/38 transition-colors hover:bg-white/6 hover:text-sidebar-foreground/70 cursor-pointer"
                    title="添加项目"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                }
              />

              <div className="space-y-1.5">
                {workspaces.length > 0 ? (
                  workspaces.map((ws) => {
                    const active = activeWorkspace ? activeWorkspace === ws.path : workspaces[0]?.path === ws.path
                    return (
                      <button
                        key={ws.path}
                        type="button"
                        onClick={() => onSwitchWorkspace(ws.path)}
                        className={`flex w-full items-center gap-3 rounded-[22px] px-4 py-3.5 text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-white/8 text-sidebar-foreground/88'
                            : 'text-sidebar-foreground/36 hover:bg-white/5 hover:text-sidebar-foreground/76'
                        }`}
                      >
                        <FolderGit2 className={`h-4 w-4 shrink-0 ${active ? 'text-sidebar-foreground/72' : 'text-sidebar-foreground/22'}`} />
                        <span className="truncate text-[13px] font-medium tracking-wide">{ws.name}</span>
                      </button>
                    )
                  })
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/8 bg-white/3 px-4 py-4 text-[12px] leading-5 text-sidebar-foreground/30">
                    暂无项目，导入代码仓库后会显示在这里。
                  </div>
                )}
              </div>
            </section>

            <section>
              <SectionTitle label="对话" />
              <div className="space-y-1">
                {conversations.length > 0 ? (
                  conversations.map((conv) => {
                    const active = conv.id === activeConversationId
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => onSelectConversation?.(conv.id, conv.path)}
                        className={`flex w-full items-center justify-between gap-3 rounded-[18px] px-4 py-2.5 text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-white/8 text-sidebar-foreground/88'
                            : 'text-sidebar-foreground/26 hover:bg-white/5 hover:text-sidebar-foreground/68'
                        }`}
                      >
                        <span className="truncate text-[13px] font-medium">{conv.name}</span>
                        <span className="shrink-0 text-[11px] font-mono text-sidebar-foreground/18">
                          {formatTimeTag(conv.createdAt)}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/8 bg-white/3 px-4 py-4 text-[12px] leading-5 text-sidebar-foreground/30">
                    智能体对话将在这里列出。
                  </div>
                )}
              </div>
            </section>

            <section>
              <SectionTitle label="快捷入口" />
              <div className="grid grid-cols-1 gap-1">
                {[
                  { icon: Blocks, label: '插件总览' },
                  { icon: Cpu, label: '自动化工作台' },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-sidebar-foreground/24"
                  >
                    <item.icon className="h-4 w-4 text-sidebar-foreground/18" />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>

      <div className="border-t border-white/6 px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="flex items-center justify-center gap-2 rounded-[18px] border border-white/8 px-3 py-3 text-[13px] font-medium text-sidebar-foreground/34 transition-colors hover:bg-white/6 cursor-pointer"
            title="主题"
          >
            {resolvedTheme === 'dark' ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span>主题</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className={`flex items-center justify-center gap-2 rounded-[18px] border px-3 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
              activeNav === 'settings'
                ? 'border-white/12 bg-white/8 text-sidebar-foreground/88'
                : 'border-white/8 text-sidebar-foreground/34 hover:bg-white/6'
            }`}
            title="设置"
          >
            <Settings className="h-4 w-4" />
            <span>设置</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
