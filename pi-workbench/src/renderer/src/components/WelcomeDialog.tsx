interface WelcomeDialogProps {
  onNewChat: () => void
  hasWorkspace?: boolean
}

export function WelcomeDialog({ onNewChat, hasWorkspace = true }: WelcomeDialogProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 min-h-[200px]">
      <h1
        className="text-[28px] font-bold text-[var(--text-primary)] tracking-tight"
        style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}
      >
        现在让它们动起来？
      </h1>
      <p
        className="text-[14px] text-[var(--text-secondary)] text-center"
        style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}
      >
        {hasWorkspace ? '选择左侧的项目或开始一个新对话' : '请先选择一个工作区'}
      </p>
      <button
        onClick={onNewChat}
        className="
          px-4 py-2.5 rounded-[10px]
          bg-[var(--accent)] text-white
          text-[14px] font-medium
          hover:bg-[var(--accent-hover)]
          transition-colors
        "
        style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}
      >
        新对话
      </button>
    </div>
  )
}
