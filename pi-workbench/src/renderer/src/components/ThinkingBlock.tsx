import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Brain } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  isComplete: boolean
}

export function ThinkingBlock({ content, isComplete }: ThinkingBlockProps) {
  return (
    <Collapsible defaultOpen={!isComplete} className="my-3 w-full animate-in fade-in duration-300">
      <div className="relative pl-4 border-l-2 border-neutral-200 dark:border-neutral-800 transition-colors">
        <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-[12px] text-neutral-400 transition-colors cursor-pointer select-none hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300">
          <Brain className={`w-3.5 h-3.5 ${!isComplete ? 'animate-pulse text-indigo-500' : ''}`} />
          <span className="font-medium tracking-wide">
            {!isComplete ? '正在深度思考中...' : '已完成思考'}
          </span>
          <ChevronDown className="w-3 h-3 ml-1 opacity-60 transition-all duration-300 data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
          <div className={`
            mt-1.5 pr-2 pb-1 text-[13px] leading-6 font-sans font-normal text-neutral-400/90 dark:text-neutral-500/90 whitespace-pre-wrap selection:bg-neutral-100
            ${!isComplete ? 'border-r border-transparent animate-pulse' : ''}
          `}>
            {content}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
