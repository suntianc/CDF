interface WelcomeDialogProps {
  onNewChat: () => void
  hasWorkspace: boolean
}

export function WelcomeDialog({ onNewChat, hasWorkspace }: WelcomeDialogProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto px-8 py-12">
      {/* Mesh gradient decorative element */}
      <div className="w-24 h-24 mb-8 rounded-[16px] bg-gradient-to-br from-[#007cf0] via-[#7928ca] via-[#ff0080] to-[#ff4d4d] opacity-80" />

      <h1 className="text-[24px] font-semibold leading-[32px] tracking-[-0.96px] text-[#171717] dark:text-white mb-3">
        我们该做什么？
      </h1>

      <p className="text-[16px] leading-[24px] text-[#4d4d4d] dark:text-[#888]">
        开始与 AI agent 对话
        <br />
        或从左侧选择一个工作区
      </p>

      <div className="mt-8 flex gap-3">
        <button
          onClick={onNewChat}
          className="px-3 py-1.5 bg-[#171717] text-white text-sm font-medium leading-5 rounded-[100px] hover:opacity-90 transition-opacity"
        >
          开始对话
        </button>
        {!hasWorkspace && (
          <button className="px-3 py-1.5 bg-white text-[#171717] text-sm font-medium leading-5 rounded-[100px] border border-[#ebebeb] hover:bg-[#fafafa] transition-colors dark:bg-[#1a1a1a] dark:text-white dark:border-[#2a2a2a]">
            添加工作区
          </button>
        )}
      </div>
    </div>
  )
}