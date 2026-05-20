import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, Brain } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  isComplete: boolean
}

export function ThinkingBlock({ content, isComplete }: ThinkingBlockProps) {
  return (
    <Collapsible defaultOpen={!isComplete} className="my-2">
      <div className="bg-[#fafafa] dark:bg-[#1c1c1c] border border-[#ebebeb] dark:border-[#2a2a2a] rounded-sm">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[#888] hover:text-[#4d4d4d] transition-colors">
            <Brain className="w-3.5 h-3.5" />
            <span>思考过程</span>
            <ChevronDown className="w-3 h-3 ml-auto transition-transform duration-200" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-2 text-[13px] leading-5 text-[#888] font-mono italic whitespace-pre-wrap border-t border-[#ebebeb] dark:border-[#2a2a2a] pt-2 mt-0">
            {content}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}