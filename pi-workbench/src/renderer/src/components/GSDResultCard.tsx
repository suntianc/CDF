import { useState } from 'react'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Copy, RefreshCw } from 'lucide-react'

interface GSDResultCardProps {
  command: string
  success: boolean
  output: string
  error?: string
  onRetry?: () => void
}

export function GSDResultCard({ command, success, output, error, onRetry }: GSDResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const outputLines = output.split('\n')
  const summary = outputLines.slice(0, 3).join('\n')
  const hasMoreOutput = outputLines.length > 3

  return (
    <div
      className={`
        rounded-md p-4 border text-sm
        ${success
          ? 'bg-[#f0fdf4] border-[#16a34a] dark:bg-[#0a1f0a]'
          : 'bg-[#fef2f2] border-[#ee0000] dark:bg-[#2a1a1a]'
        }
      `}
    >
      {/* Header: status icon + command name */}
      <div className="flex items-center gap-2 mb-2">
        {success
          ? <CheckCircle className="w-4 h-4 text-[#16a34a]" />
          : <XCircle className="w-4 h-4 text-[#ee0000]" />
        }
        <span className="font-mono text-sm font-semibold text-[#171717] dark:text-white">
          /gsd-{command}
        </span>
        <span className={`text-xs font-medium ${success ? 'text-[#16a34a]' : 'text-[#ee0000]'}`}>
          {success ? '执行成功' : '执行失败'}
        </span>
      </div>

      {/* Output summary */}
      <div className="font-mono text-[13px] leading-5 text-[#4d4d4d] dark:text-[#ebebeb] whitespace-pre-wrap mb-2">
        {expanded ? output : summary}
        {!expanded && hasMoreOutput && (
          <span className="text-[#888]">...</span>
        )}
      </div>

      {error && !success && (
        <div className="text-[13px] text-[#ee0000] mb-2 font-mono bg-[#fee2e2] dark:bg-[#3a1a1a] p-2 rounded">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-2">
        {hasMoreOutput && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-[#0070f3] hover:text-[#0052cc] transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="w-3 h-3" /> 收起</>
            ) : (
              <><ChevronDown className="w-3 h-3" /> 展开</>
            )}
          </button>
        )}

        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-[#888] hover:text-[#4d4d4d] transition-colors"
        >
          {copied ? (
            <><CheckCircle className="w-3 h-3 text-[#16a34a]" /> 已复制</>
          ) : (
            <><Copy className="w-3 h-3" /> 复制</>
          )}
        </button>

        {!success && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-xs text-[#ee0000] hover:text-[#cc0000] transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> 重试
          </button>
        )}
      </div>
    </div>
  )
}