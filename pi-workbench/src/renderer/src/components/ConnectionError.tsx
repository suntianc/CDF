import { AlertCircle } from 'lucide-react'

interface ConnectionErrorProps {
  message: string
  onRetry?: () => void
}

export function ConnectionError({ message, onRetry }: ConnectionErrorProps) {
  return (
    <div className="bg-[#f7d4d6] dark:bg-[#3a1a1a] rounded-[6px] p-3 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-[#ee0000] mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-xs text-[#c50000]">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs text-[#c50000] underline mt-1 hover:no-underline"
          >
            请检查 API Key 是否正确，或稍后重试
          </button>
        )}
      </div>
    </div>
  )
}