import { useEffect, useState, useCallback } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  ClipboardList,
  Play,
  MessageSquare,
  Eye,
  FilePlus,
  Activity,
  Flag,
  Map,
} from 'lucide-react'

interface GSDCommand {
  id: string
  name: string
  description: string
  args: string
  icon: string
}

const ICON_MAP: Record<string, React.ReactNode> = {
  plan: <ClipboardList className="w-4 h-4" />,
  execute: <Play className="w-4 h-4" />,
  discuss: <MessageSquare className="w-4 h-4" />,
  review: <Eye className="w-4 h-4" />,
  new: <FilePlus className="w-4 h-4" />,
  status: <Activity className="w-4 h-4" />,
  milestone: <Flag className="w-4 h-4" />,
  roadmap: <Map className="w-4 h-4" />,
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (command: string, args: string) => void
  commands?: GSDCommand[]
  filter: string
}

export function CommandPalette({ open, onOpenChange, onSelect, commands, filter }: CommandPaletteProps) {
  const [loadedCommands, setLoadedCommands] = useState<GSDCommand[]>(commands || [])

  // Load commands from IPC if not provided
  useEffect(() => {
    if (!commands && window.api?.gsd?.listCommands) {
      window.api.gsd.listCommands()
        .then(setLoadedCommands)
        .catch(() => {
          setLoadedCommands([])
        })
    }
  }, [commands])

  const handleSelect = useCallback((command: GSDCommand) => {
    onSelect(command.name, command.args)
    onOpenChange(false)
  }, [onSelect, onOpenChange])

  const displayCommands = commands || loadedCommands

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="搜索 GSD 命令..."
        defaultValue={filter}
      />
      <CommandList className="max-h-[300px]">
        <CommandEmpty>没有找到匹配的命令</CommandEmpty>
        <CommandGroup heading="GSD Commands">
          {displayCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={`${cmd.name} ${cmd.description}`}
              onSelect={() => handleSelect(cmd)}
              className="flex items-center gap-3 px-3 py-2"
            >
              <span className="w-5 h-5 flex items-center justify-center text-[#888] shrink-0">
                {ICON_MAP[cmd.icon] || <Play className="w-4 h-4" />}
              </span>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-mono font-semibold text-[#171717] dark:text-white">
                  {cmd.name}
                </span>
                <span className="text-xs text-[#888] truncate">
                  {cmd.description}
                </span>
              </div>
              {cmd.args && (
                <span className="text-[11px] font-mono text-[#888] shrink-0">
                  {cmd.args}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
