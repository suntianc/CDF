import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import type { DelegatedTask } from '../../stores/sessionStore';
import { estimateTokens } from '../../stores/sessionStore';

interface AgentTraceModalProps {
  open: boolean;
  onClose: () => void;
  task: DelegatedTask | null;
}

function AgentTraceModal({ open, onClose, task }: AgentTraceModalProps) {
  const { t } = useTranslation();

  // Hooks before any early return (Rules of Hooks)
  const totalText = useMemo(
    () => !task ? '' : (task.chunks.length > 0 ? task.chunks.join('') : (task.result?.summary || '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task?.chunks, task?.result?.summary],
  );
  const tokenEstimate = useMemo(() => estimateTokens(totalText), [totalText]);
  const tokenDisplay = tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;

  if (!task) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl" />
      </Dialog>
    );
  }

  const isRunning = task.status === 'running';
  const isFailure = task.status === 'failure';
  const hasChunks = task.chunks.length > 0;
  const showEmptyState = !hasChunks && !isRunning && !task.result?.summary;

  const statusLabel = isRunning
    ? t('taskPanel.statusRunning')
    : isFailure
      ? t('taskPanel.statusFailed')
      : t('taskPanel.statusCompleted');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {/* [P1-A] motion-reduce on status dot pulse */}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isRunning ? 'bg-[var(--color-accent)] animate-pulse motion-reduce:animate-none'
                : isFailure ? 'bg-[var(--color-danger)]'
                : 'bg-[var(--color-success)]'
              }`}
              aria-hidden="true"
            />
            {t('traceModal.title', { name: task.agentName })}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px] tabular-nums">
            {tokenDisplay} {t('traceModal.tokensEstimate')} · {statusLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto space-y-3">
          {/* Work Goal */}
          <div>
            {/* [P1-B] text-muted → text-secondary for WCAG AA contrast on 12px text */}
            <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              {t('traceModal.workGoal')}
            </div>
            <p className="text-sm text-[var(--color-text-primary)] leading-relaxed max-w-[65ch]">
              {task.goal || t('traceModal.noGoal')}
            </p>
          </div>

          {/* Failure Alert */}
          {isFailure && (
            <div
              role="alert"
              className="rounded-md bg-[var(--color-danger)]/8 border border-[var(--color-danger)]/25 p-2.5 space-y-1"
            >
              <div className="text-xs text-[var(--color-danger)]">
                <span className="font-semibold">{t('traceModal.errorCode')}</span>{' '}
                {task.errorCode || t('traceModal.statusUnknown')}
              </div>
              {task.result?.error?.message && (
                <div className="text-[11px] text-[var(--color-danger)] opacity-85 leading-relaxed">
                  {task.result.error.message}
                </div>
              )}
            </div>
          )}

          {/* Execution Log */}
          <div>
            {/* [P1-B] text-muted → text-secondary */}
            <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              {t('traceModal.executionLog')}
            </div>
            {showEmptyState ? (
              <div className="rounded-md bg-[var(--color-bg-app)] border border-[var(--color-border)] p-3 text-[var(--color-text-muted)] text-xs">
                {t('traceModal.noLog')}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-app)] rounded-md p-3 border border-[var(--color-border)] max-h-[50vh] overflow-y-auto">
                {totalText || t('traceModal.waitingOutput')}
                {isRunning && (
                  <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--color-accent)] animate-pulse motion-reduce:animate-none align-middle" />
                )}
              </pre>
            )}
          </div>

          {/* [P3-B] Stats bar — chunk count only; token count is already in header description */}
          {hasChunks && (
            <div className="text-[11px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]/40 pt-2 font-mono tabular-nums">
              {t('traceModal.chunkCount', { count: task.chunks.length })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { AgentTraceModal };
