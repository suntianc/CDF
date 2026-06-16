import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useSessionStore, estimateTokens } from '../../stores/sessionStore';
import type { DelegatedTask } from '../../stores/sessionStore';
import { StreamdownRenderer } from './StreamdownRenderer';

const GOAL_COLLAPSED_MAX_H = 'max-h-[4.5em]';

export function SubagentView({ task, onBack }: { task: DelegatedTask; onBack: () => void }) {
  const { t } = useTranslation();
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [goalExpanded, setGoalExpanded] = useState(false);

  const isRunning = task.status === 'running';
  const isFailure = task.status === 'failure';

  const totalText = useMemo(
    () => task.chunks.length > 0 ? task.chunks.join('') : (task.result?.summary || ''),
    [task.chunks, task.result?.summary],
  );
  const tokenEstimate = useMemo(() => estimateTokens(totalText), [totalText]);
  const tokenDisplay = tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;

  const elapsed = useMemo(() => {
    if (isRunning || !task.startedAt) return null;
    const end = task.completedAt ?? Date.now();
    const s = Math.max(0, Math.round((end - task.startedAt) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }, [isRunning, task.startedAt, task.completedAt]);

  const goalNeedsCollapse = (task.goal?.length ?? 0) > 200;

  useEffect(() => {
    setGoalExpanded(false);
  }, [task.taskId]);

  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [totalText, isRunning]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Nav bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-app)] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs min-h-11 py-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t('subagentView.backToMaster')}
        </button>
        <span className="text-[var(--color-border)]">·</span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isRunning ? 'bg-[var(--color-accent)] animate-pulse motion-reduce:animate-none'
            : isFailure ? 'bg-[var(--color-danger)]'
            : 'bg-[var(--color-success)]'
          }`}
        />
        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{task.agentName}</span>
        <span className="text-xs font-mono text-[var(--color-text-secondary)] tabular-nums ml-auto">
          {tokenDisplay} {t('taskPanel.tokenUnit')}{elapsed ? ` · ${elapsed}` : ''}
        </span>
      </div>

      {/* Goal — collapsible when long */}
      {task.goal && (
        <div className="px-6 pt-3 pb-1 shrink-0 border-b border-[var(--color-border)]/40">
          <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">{t('taskPanel.taskGoal')}:</div>
          <div className={`relative text-xs text-[var(--color-text-secondary)] leading-relaxed ${
            goalNeedsCollapse
              ? goalExpanded ? 'max-h-[40vh] overflow-y-auto' : `${GOAL_COLLAPSED_MAX_H} overflow-hidden`
              : ''
          }`}>
            <StreamdownRenderer text={task.goal} isTypewriting={false} />
            {goalNeedsCollapse && !goalExpanded && (
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--color-bg-app)] to-transparent" />
            )}
          </div>
          {goalNeedsCollapse && (
            <button
              type="button"
              onClick={() => setGoalExpanded(!goalExpanded)}
              aria-expanded={goalExpanded}
              className="flex items-center gap-0.5 mt-1 text-xs text-[var(--color-accent)] hover:underline"
            >
              {goalExpanded ? (
                <><ChevronUp className="w-3 h-3" />{t('subagentView.collapseGoal')}</>
              ) : (
                <><ChevronDown className="w-3 h-3" />{t('subagentView.expandGoal')}</>
              )}
            </button>
          )}
        </div>
      )}

      {/* Failure alert */}
      {isFailure && (
        <div className="mx-6 mt-2 rounded-md bg-[var(--color-danger)]/8 border border-[var(--color-danger)]/25 p-2.5 space-y-1 shrink-0" role="alert">
          <div className="text-xs text-[var(--color-danger)]">
            <span className="font-semibold">{task.errorCode || t('taskPanel.taskFailed', { code: '' })}</span>
          </div>
          {task.result?.error?.message && (
            <div className="text-xs text-[var(--color-danger)] leading-relaxed">{task.result.error.message}</div>
          )}
        </div>
      )}

      {/* Streaming content — scrollable */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 px-6 py-4"
      >
        {totalText ? (
          <div className="max-w-[760px] mx-auto pb-20">
            <StreamdownRenderer text={totalText} isTypewriting={isRunning} />
            {isRunning && (
              <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--color-accent)] animate-pulse motion-reduce:animate-none align-middle" />
            )}
          </div>
        ) : (
          <div className="max-w-[760px] mx-auto text-xs text-[var(--color-text-muted)] font-mono">
            {isRunning ? t('subagentView.waiting') : t('subagentView.noOutput')}
          </div>
        )}
      </div>

      {/* Master still streaming toast */}
      {isStreaming && !isRunning && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-lg px-4 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {t('subagentView.masterUpdating')}
          </button>
        </div>
      )}
    </div>
  );
}
