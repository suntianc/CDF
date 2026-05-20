interface WelcomeDialogProps {
  onNewChat: () => void
  hasWorkspace: boolean
}

export function WelcomeDialog({ onNewChat, hasWorkspace }: WelcomeDialogProps) {
  return (
    <div className="flex flex-col items-center text-center max-w-sm mx-auto">
      {/* Mesh gradient decorative element */}
      <div className="w-20 h-20 mb-6 rounded-2xl bg-gradient-to-br from-[#007cf0] via-[#7928ca] via-[#ff0080] to-[#ff4d4d] opacity-80" />

      <h1 className="text-2xl font-semibold tracking-tight text-[#171717] dark:text-white mb-2">
        我们该做什么？
      </h1>

      <p className="text-base leading-6 text-[#4d4d4d] dark:text-[#888] mb-6">
        开始与 AI agent 对话
        <br />
        或从左侧选择一个工作区
      </p>

      <button
        onClick={onNewChat}
        className="px-5 py-2 bg-[#171717] text-white text-sm font-medium rounded-full hover:opacity-90 transition-opacity"
      >
        开始对话
      </button>
    </div>
  )
}