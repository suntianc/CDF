import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useSessionStore, estimateTokens } from '../../stores/sessionStore';
import type { DelegatedTask, ParallelWorker } from '../../stores/sessionStore';
import type { ExecutionStep } from '../../../../shared/types';
import { StreamdownRenderer } from './StreamdownRenderer';
import { MessageContentRenderer } from './MessageItem';
import { ToolMessageCard } from './ToolMessageCard';
import type { ToolInfo } from './ToolMessageCard';

const GOAL_COLLAPSED_MAX_H = 'max-h-[4.5em]';

type SubagentInput = DelegatedTask | ParallelWorker;

function isDelegatedTask(t: SubagentInput): t is DelegatedTask {
  return 'chunks' in t;
}

function pairToolSteps(
  steps: ExecutionStep[],
  ownerStatus: 'running' | 'success' | 'failure',
): Array<{ info: ToolInfo; createdAt: number }> {
  const pairs: Array<{ info: ToolInfo; createdAt: number }> = [];
  const pendingBySpan = new Map<string, number>();

  for (const step of steps) {
    if (step.type === 'tool_call') {
      const idx = pairs.length;
      pairs.push({
        info: { type: 'tool', name: step.tool || 'unknown', status: 'running', input: step.args },
        createdAt: step.ts,
      });
      if (step.spanId) pendingBySpan.set(step.spanId, idx);
    } else if (step.type === 'tool_result') {
      if (step.spanId && pendingBySpan.has(step.spanId)) {
        const idx = pendingBySpan.get(step.spanId)!;
        pendingBySpan.delete(step.spanId);
        pairs[idx] = {
          ...pairs[idx],
          info: {
            ...pairs[idx].info,
            status: step.success !== false ? 'success' : 'error',
            output: step.success !== false ? step.output : undefined,
            error: step.success === false ? step.error : undefined,
          },
        };
      }
    }
  }

  if (ownerStatus !== 'running') {
    for (const idx of pendingBySpan.values()) {
      pairs[idx] = {
        ...pairs[idx],
        info: {
          ...pairs[idx].info,
          status: ownerStatus === 'failure' ? 'error' : 'success',
          error: ownerStatus === 'failure' ? 'Tool call ended without a result payload' : undefined,
        },
      };
    }
  }

  return pairs;
}

function StepTimeline({ steps, textBuffer, isRunning, ownerStatus, messageId }: {
  steps: ExecutionStep[];
  textBuffer: string;
  isRunning: boolean;
  ownerStatus: 'running' | 'success' | 'failure';
  messageId?: string;
}) {
  const pairs = useMemo(() => pairToolSteps(steps, ownerStatus), [steps, ownerStatus]);

  return (
    <div>
      {pairs.length > 0 && (
        <div className="mb-4">
          {pairs.map((p, i) => (
            <ToolMessageCard key={i} toolInfo={p.info} createdAt={p.createdAt} />
          ))}
        </div>
      )}
      {pairs.length > 0 && textBuffer && (
        <div className="h-px bg-[var(--color-border)]/30 mb-3" />
      )}
      {textBuffer ? (
        <MessageContentRenderer
          content={textBuffer}
          isLast={isRunning}
          isStreaming={isRunning}
          messageId={messageId}
          thinkRecent={isRunning}
        />
      ) : null}
    </div>
  );
}

export function SubagentView({ task, onBack }: { task: SubagentInput; onBack: () => void }) {
  const { t } = useTranslation();
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [goalExpanded, setGoalExpanded] = useState(false);

  const isDelegate = isDelegatedTask(task);
  const isRunning = task.status === 'running';
  const isFailure = task.status === 'failure';
  const agentName = isDelegate ? task.agentName : (task.agentName ?? task.agentSlug);
  const taskKey = isDelegate ? task.taskId : (task as ParallelWorker).delegatedRunId;

  const totalText = useMemo(
    () => isDelegate
      ? (task.chunks.length > 0 ? task.chunks.join('') : (task.result?.summary || ''))
      : ((task as ParallelWorker).textBuffer ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDelegate, isDelegate ? (task as DelegatedTask).chunks.join('') : (task as ParallelWorker).textBuffer],
  );
  const tokenEstimate = useMemo(() => estimateTokens(totalText), [totalText]);
  const tokenDisplay = tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;

  const elapsed = useMemo(() => {
    if (isRunning || !task.startedAt) return null;
    const end = task.completedAt ?? Date.now();
    const s = Math.max(0, Math.round((end - task.startedAt) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }, [isRunning, task.startedAt, task.completedAt]);

  const goal = task.goal;
  const goalNeedsCollapse = (goal?.length ?? 0) > 200;

  useEffect(() => {
    setGoalExpanded(false);
  }, [taskKey]);

  useEffect(() => {
    if (isRunning && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [totalText, isRunning]);

  const hasContent = totalText.length > 0 || task.steps.length > 0;

  const emptyLabel = isRunning
    ? t('subagentView.waiting')
    : (isFailure && isDelegate)
      ? t('subagentView.noOutputFailure')
      : t('subagentView.noOutput');

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Nav bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-app)] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="group flex items-center gap-1.5 text-xs min-h-11 py-2 rounded-md px-2 -ml-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" />
          {t('subagentView.backToMaster')}
        </button>
        <div className="w-px h-3.5 bg-[var(--color-border)] shrink-0" />
        <span className={`relative flex shrink-0 w-2 h-2`}>
          {isRunning && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-50 motion-reduce:hidden" />
          )}
          <span className={`relative inline-flex rounded-full w-2 h-2 ${
            isRunning ? 'bg-[var(--color-accent)]'
            : isFailure ? 'bg-[var(--color-danger)]'
            : 'bg-[var(--color-success)]'
          }`} />
        </span>
        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{agentName}</span>
        <span className="shrink-0 ml-auto bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-secondary)] tabular-nums">
          {tokenDisplay} {t('taskPanel.tokenUnit')}{elapsed ? ` · ${elapsed}` : ''}
        </span>
      </div>

      {/* Goal — collapsible when long */}
      {goal && (
        <div className="px-6 pt-3 pb-1 shrink-0 border-b border-[var(--color-border)]/40">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)] mb-1">
            <span className="w-px h-3 rounded-full bg-[var(--color-accent)] opacity-40 shrink-0" />
            {t('taskPanel.taskGoal')}:
          </div>
          <div className={`relative text-xs text-[var(--color-text-secondary)] leading-relaxed ${
            goalNeedsCollapse
              ? goalExpanded ? 'max-h-[40vh] overflow-y-auto' : `${GOAL_COLLAPSED_MAX_H} overflow-hidden`
              : ''
          }`}>
            <StreamdownRenderer text={goal} isTypewriting={false} density="compact" />
            {goalNeedsCollapse && !goalExpanded && (
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--color-bg-app)] to-transparent" />
            )}
          </div>
          {goalNeedsCollapse && (
            <button
              type="button"
              onClick={() => setGoalExpanded(!goalExpanded)}
              aria-expanded={goalExpanded}
              className="flex items-center gap-0.5 mt-1 min-h-8 py-0.5 px-1.5 -mx-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/8 rounded active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
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
        <div className="mx-6 mt-2 rounded-md bg-[var(--color-danger)]/8 ring-1 ring-[var(--color-danger)]/25 border-l-2 border-[var(--color-danger)]/60 p-2.5 space-y-1 shrink-0" role="alert">
          <div className="text-xs text-[var(--color-danger)]">
            <span className="font-semibold">{isDelegate ? (task.errorCode || t('taskPanel.taskFailed', { code: '' })) : t('taskPanel.taskFailed', { code: '' })}</span>
          </div>
          {isDelegate && task.result?.error?.message && (
            <div className="text-xs text-[var(--color-danger)] leading-relaxed">{task.result.error.message}</div>
          )}
        </div>
      )}

      {/* Content — scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
        {hasContent ? (
          <div className="max-w-[760px] mx-auto pb-20">
            <StepTimeline
              steps={task.steps}
              textBuffer={totalText}
              isRunning={isRunning}
              ownerStatus={task.status}
            />
          </div>
        ) : (
          <div className={`max-w-[760px] mx-auto text-xs font-mono ${isFailure ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}>
            {emptyLabel}
          </div>
        )}
      </div>

      {/* Master still streaming toast */}
      {isStreaming && !isRunning && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full backdrop-blur-md bg-[var(--color-bg-surface)]/90 border border-[var(--color-border)] shadow-lg min-h-11 px-4 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] active:scale-[0.98] transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
          >
            {t('subagentView.masterUpdating')}
          </button>
        </div>
      )}
    </div>
  );
}
