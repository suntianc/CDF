import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
 * Per UI-SPEC.md §Surface 4 + F-01: uses `--color-info` (blue).
 * Active state (modal is open) switches the variant to default so
 * the user has visual feedback that the modal is up.
 */
export function ContextButton() {
  const { t } = useTranslation();
  const isOpen = useContextModalStore((s) => s.isOpen);
  const open = useContextModalStore.getState().open;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid="context-button"
          variant="ghost"
          size="sm"
          onClick={open}
          aria-label={t('context.viewContext')}
          className={cn(
            'h-7 gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] border-0 shadow-none px-1.5 py-1 rounded-md cursor-pointer transition-colors',
            isOpen && 'text-[var(--color-info)] hover:text-[var(--color-info)] font-semibold'
          )}
        >
          <BarChart3 className="size-3.5 shrink-0" />
          <span className="text-xs font-semibold">Context</span>
          <span className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300",
            isOpen ? "bg-[var(--color-info)] animate-pulse" : "bg-[var(--color-text-muted)]"
          )} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('context.tooltipDetail')}</TooltipContent>
    </Tooltip>
  );
}

export default ContextButton;
