import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Terminal, CheckCircle2, Loader2, XCircle } from 'lucide-react'

interface ToolCallCardProps {
  name: string
  args: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
}

const STATUS_BADGE: Record<string, { label: string; variant: 'outline' | 'secondary' | 'destructive' }> = {
  running: { label: '运行中', variant: 'outline' },
  completed: { label: '已完成', variant: 'secondary' },
  error: { label: '出错', variant: 'destructive' },
}

export function ToolCallCard({ name, args, status, result }: ToolCallCardProps) {
  const badge = STATUS_BADGE[status]

  return (
    <div className="my-2 bg-[#f5f5f5] dark:bg-[#252525] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Terminal className="w-3.5 h-3.5 text-[#888]" />
        <span className="text-[13px] font-semibold font-mono text-[#171717] dark:text-white">
          {name}
        </span>
        <Badge variant={badge.variant} className="ml-auto text-[10px]">
          {status === 'running' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
          {status === 'error' && <XCircle className="w-3 h-3 mr-1" />}
          {badge.label}
        </Badge>
      </div>

      {/* Args (collapsible) */}
      {Object.keys(args).length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 w-full px-3 py-1 text-xs text-[#888] hover:text-[#4d4d4d] border-t border-[#ebebeb] dark:border-[#2a2a2a] transition-colors">
              <ChevronDown className="w-3 h-3" />
              参数 ({Object.keys(args).length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="px-3 py-2 text-[12px] leading-4 font-mono text-[#4d4d4d] dark:text-[#ebebeb] whitespace-pre-wrap border-t border-[#ebebeb] dark:border-[#2a2a2a]">
              {JSON.stringify(args, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Result (when completed) */}
      {result && (
        <div className="px-3 py-2 text-[12px] leading-4 font-mono text-[#4d4d4d] dark:text-[#ebebeb] border-t border-[#ebebeb] dark:border-[#2a2a2a] max-h-[200px] overflow-y-auto">
          {result}
        </div>
      )}
    </div>
  )
}