import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContextModalStore } from '@/stores/contextModalStore';
import { cn } from '@/lib/utils';

/**
 * 08.2 P4 C2-04: persistent button in the composer area that opens the
 * <ContextModal>. Dual entry alongside the /context slash command.
 *
 * Per UI-SPEC.md §Surface 4 + F-01: uses `--color-info` (blue), NOT
 * `--color-accent` (purple, reserved for /plan). Active state (modal
 * is open) switches the variant to default so the user has visual
 * feedback that the modal is up.
 */
export function ContextButton() {
  const isOpen = useContextModalStore((s) => s.isOpen);
  const open = useContextModalStore.getState().open;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid="context-button"
          variant={isOpen ? 'default' : 'ghost'}
          size="sm"
          onClick={open}
          aria-label="查看 context"
          className={cn(
            'min-h-[32px] gap-1.5 text-[var(--color-info)] hover:text-[var(--color-info)]',
            isOpen && 'bg-[var(--color-info)] text-white hover:bg-[var(--color-info)]/90'
          )}
        >
          <BarChart3 className="size-4" />
          <span>📊 查看 context</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>显示当前 context token 占用明细</TooltipContent>
    </Tooltip>
  );
}

export default ContextButton;
