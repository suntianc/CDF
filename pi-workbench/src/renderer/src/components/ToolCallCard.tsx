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
    <div className="my-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
        <span className="text-[13px] font-semibold font-mono text-neutral-700 dark:text-neutral-200">
          {name}
        </span>
        <Badge variant={badge.variant} className="ml-auto text-[10px]">
          {status === 'running' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
          {status === 'error' && <XCircle className="w-3 h-3 mr-1" />}
          {badge.label}
        </Badge>
      </div>

      {Object.keys(args).length > 0 && (
        <Collapsible className="mt-2 border-t border-neutral-200 pt-1 dark:border-neutral-700">
          <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-left text-xs text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
            <ChevronDown className="w-3 h-3 transition-transform duration-200 data-[panel-open]:rotate-180" />
            参数 ({Object.keys(args).length})
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
            <pre className="mt-1 whitespace-pre-wrap rounded-md bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-300">
              {JSON.stringify(args, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {result && (
        <div className="mt-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-md bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-500 dark:bg-neutral-900/50 dark:text-neutral-300">
          {result}
        </div>
      )}
    </div>
  )
}
