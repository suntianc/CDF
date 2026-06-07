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
          variant={isOpen ? 'default' : 'ghost'}
          size="sm"
          onClick={open}
          aria-label={t('context.viewContext')}
          className={cn(
            'min-h-[32px] gap-2 text-[var(--color-info)] border border-[var(--color-info-dim)]/20 bg-[var(--color-info-dim)]/5 hover:bg-[var(--color-info-dim)]/15 transition-all duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-95 shadow-sm rounded-lg',
            isOpen && 'bg-[var(--color-info)] text-white hover:bg-[var(--color-info)]/90 border-transparent hover:-translate-y-0 shadow-inner'
          )}
        >
          <BarChart3 className="size-3.5 shrink-0" />
          <span className="text-xs font-semibold tracking-wide">Context</span>
          <span className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300",
            isOpen ? "bg-white animate-pulse" : "bg-[var(--color-info)]"
          )} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('context.tooltipDetail')}</TooltipContent>
    </Tooltip>
  );
}

export default ContextButton;
