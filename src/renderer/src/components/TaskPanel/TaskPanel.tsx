import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ChevronRight, CircleAlert, Clock, FileText, Loader, ShieldAlert, X, XCircle } from 'lucide-react';
// ChevronDown/ChevronRight/ExternalLink removed — sub-agent detail now renders in ChatArea
import { useSessionStore } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { AgentRunStatus } from '../../../../shared/types';
import {
  projectActivityPanel,
  type ActivityPanelApprovalActionSummary,
  type ActivityPanelDelegatedTaskItem,
  type ActivityPanelParallelWorkSection,
} from './activityPanelProjection/activityPanelProjection';

export interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

// [P2-D] Icons alongside text labels are decorative — aria-hidden, not aria-label
function RunStatusIcon({ status }: { status?: AgentRunStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-[var(--color-danger)]" aria-hidden="true" />;
    case 'aborted':
      return <CircleAlert className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />;
    case 'waiting_approval':
      return <ShieldAlert className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />;
    default:
      return <Loader className="w-4 h-4 animate-spin motion-reduce:animate-none text-[var(--color-accent)]" aria-hidden="true" />;
  }
}

function ApprovalActionCard({ summary }: { summary: ActivityPanelApprovalActionSummary }) {
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{summary.title}</span>
        </div>
        {/* [P1-B] 10px → 11px secondary for WCAG AA contrast */}
        <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
          {summary.name}
        </span>
      </div>
      {summary.target && (
        <div className="bg-[var(--color-bg-app)] px-2 py-1.5">
          <div className="text-xs text-[var(--color-text-secondary)]">{summary.targetLabel}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-text-primary)]">{summary.target}</div>
        </div>
      )}
      {summary.preview && (
        <div className="bg-[var(--color-bg-app)] px-2 py-1.5">
          <div className="text-xs text-[var(--color-text-secondary)]">{summary.previewLabel}</div>
          <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text-primary)]" title={summary.preview}>
            {summary.preview}
          </pre>
        </div>
      )}
    </div>
  );
}

function DelegatedTaskCard({ item, onSelect }: {
  item: ActivityPanelDelegatedTaskItem;
  onSelect: () => void;
}) {
  const isRunning = item.task.status === 'running';
  const isFailure = item.task.status === 'failure';

  return (
    <div className="relative pl-7 pb-3 last:pb-0">
      {/* Masking container for status icon to align with timeline rail */}
      <div 
        className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 bg-[var(--color-bg-sidebar)] rounded-full z-10" 
        aria-hidden="true"
      >
        {isRunning ? (
          <Loader className="w-4 h-4 animate-spin text-[var(--color-accent)] motion-reduce:animate-none" />
        ) : isFailure ? (
          <XCircle className="w-4 h-4 text-[var(--color-danger)]" />
        ) : (
          <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
        )}
      </div>

      <button
        type="button"
        aria-label={`${item.agentName} (${item.statusText})`}
        onClick={onSelect}
        className={`w-full text-left p-2.5 rounded-md border transition-[background-color,border-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-sidebar)] focus-visible:outline-none ${
          item.isActive
            ? 'bg-[var(--color-accent-dim)] border-[var(--color-accent)]/30'
            : 'bg-[var(--color-bg-surface)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{item.agentName}</span>
          <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums whitespace-nowrap">
            <span>{item.metricsText}</span>
            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" aria-hidden="true" />
          </div>
        </div>
      </button>
    </div>
  );
}

function ParallelBatchSection({ section }: { section: ActivityPanelParallelWorkSection | null }) {
  const setViewingParallelWorker = useSessionStore((s) => s.setViewingParallelWorker);

  if (!section || section.batches.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">{section.title}</h3>
      {section.batches.map((batch) => (
        <div key={batch.batchId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-1.5">
          {batch.workers.map((item) => {
            const worker = item.worker;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setViewingParallelWorker({ batchId: batch.batchId, agentSlug: worker.agentSlug, workerId: worker.workerId })}
                className={`w-full flex flex-col gap-1 p-2 rounded-md border transition-[background-color,border-color] duration-150 text-left focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-surface)] focus-visible:outline-none ${
                  item.isActive
                    ? 'bg-[var(--color-accent-dim)] border-[var(--color-accent)]/30'
                    : 'bg-[var(--color-bg-app)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {worker.status === 'running'
                      ? <Loader className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-[var(--color-accent)]" aria-hidden="true" />
                      : worker.status === 'failure'
                        ? <XCircle className="w-3.5 h-3.5 text-[var(--color-danger)]" aria-hidden="true" />
                        : <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" aria-hidden="true" />
                    }
                    <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{item.displayName}</span>
                  </div>
                  <span className="text-[10px] tabular-nums text-[var(--color-text-muted)] shrink-0 font-mono">{item.tokenDisplay} {item.tokenUnit}</span>
                </div>
                {item.previewText && (
                  <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed line-clamp-2 pl-5">{item.previewText}</p>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TaskPanelContent({ isOpen }: { isOpen: boolean }) {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeRunId = useSessionStore((state) => state.activeRunId);
  const agentRuns = useSessionStore((state) => state.agentRuns);
  const agentToolCalls = useSessionStore((state) => state.agentToolCalls);
  const delegatedTasks = useSessionStore((state) => state.delegatedTasks);
  const parallelBatches = useSessionStore((state) => state.parallelBatches);
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const fetchAgentActivity = useSessionStore((state) => state.fetchAgentActivity);
  const resolveApproval = useSessionStore((state) => state.resolveApproval);
  const pendingWorkflowApproval = useWorkflowStore((state) => state.pendingWorkflowApproval);
  const resolveWorkflowApproval = useWorkflowStore((state) => state.resolveWorkflowApproval);
  const viewingSubagentId = useSessionStore((state) => state.viewingSubagentId);
  const setViewingSubagent = useSessionStore((state) => state.setViewingSubagent);
  const viewingParallelWorker = useSessionStore((state) => state.viewingParallelWorker);
  const agents = useAgentStore((state) => state.agents);

  const projection = useMemo(
    () => projectActivityPanel({
      activeSessionId,
      activeRunId,
      agentRuns,
      agentToolCalls,
      delegatedTasks,
      parallelBatches,
      pendingApproval,
      pendingWorkflowApproval,
      agents,
      viewingSubagentId,
      viewingParallelWorker,
      t,
    }),
    [
      activeSessionId,
      activeRunId,
      agentRuns,
      agentToolCalls,
      delegatedTasks,
      parallelBatches,
      pendingApproval,
      pendingWorkflowApproval,
      agents,
      viewingSubagentId,
      viewingParallelWorker,
      t,
    ],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!activeSessionId) return;
    fetchAgentActivity(activeSessionId).catch(() => undefined);
  }, [isOpen, activeSessionId, fetchAgentActivity]);

  return (
    <>
      {projection.sessionEmptyState && (
        <div className="text-xs text-[var(--color-text-muted)]">{projection.sessionEmptyState.message}</div>
      )}

      {projection.runSection && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <RunStatusIcon status={projection.runSection.run.status} />
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {projection.runSection.statusLabel}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{new Date(projection.runSection.startedAt).toLocaleTimeString()}</span>
          </div>
          {projection.runSection.error && (
            <div className="text-xs text-[var(--color-danger)] whitespace-pre-wrap">{projection.runSection.error}</div>
          )}
        </div>
      )}

      {projection.toolSummarySection && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">{t('taskPanel.toolSummaryTitle')}</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">{projection.toolSummarySection.total}</div>
              {/* [P1-B] 10px → 11px secondary */}
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryTotal')}</div>
            </div>
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">{projection.toolSummarySection.running}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryRunning')}</div>
            </div>
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-danger)]">{projection.toolSummarySection.failedCount}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryFailed')}</div>
            </div>
          </div>
          {projection.toolSummarySection.failedCalls.map((toolCall) => (
            <div key={toolCall.id} className="text-xs text-[var(--color-danger)]">
              {toolCall.toolName}: {toolCall.errorText}
            </div>
          ))}
        </div>
      )}

      {projection.conversationApprovalSection && (
        <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-bg-surface)] p-3 shadow-sm space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-warning-dim)] text-[var(--color-warning)]">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              {/* [P2-G] div → h3 for proper heading hierarchy */}
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{projection.conversationApprovalSection.title}</h3>
              {/* [P1-B] muted → secondary */}
              <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                {projection.conversationApprovalSection.actionCountText}
              </div>
            </div>
          </div>
          <div id="pending-approval-actions" className="space-y-3 w-full">
            {projection.conversationApprovalSection.actions.map((summary) => (
              <ApprovalActionCard key={summary.key} summary={summary} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary text-xs min-h-11" aria-describedby="pending-approval-actions" onClick={() => resolveApproval('approve')}>
              {t('common.approve')}
            </button>
            <button type="button" className="btn btn-secondary text-xs min-h-11 text-[var(--color-danger)]" aria-describedby="pending-approval-actions" onClick={() => resolveApproval('reject')}>
              {t('common.reject')}
            </button>
          </div>
        </div>
      )}

      {projection.workflowApprovalSection && (
        <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-bg-surface)] p-3 shadow-sm space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-warning-dim)] text-[var(--color-warning)]">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{projection.workflowApprovalSection.title}</h3>
              <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{projection.workflowApprovalSection.description}</div>
            </div>
          </div>
          <div id="pending-workflow-approval-actions" className="space-y-2 w-full">
            {projection.workflowApprovalSection.actions.map((action) => (
              <div key={action.key} className="flex items-center gap-2 border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
                  {action.label}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-primary text-xs min-h-11"
              aria-describedby="pending-workflow-approval-actions"
              onClick={() => resolveWorkflowApproval('approve')}
            >
              {t('common.approve')}
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs min-h-11 text-[var(--color-danger)]"
              aria-describedby="pending-workflow-approval-actions"
              onClick={() => resolveWorkflowApproval('reject')}
            >
              {t('common.reject')}
            </button>
          </div>
        </div>
      )}

      {projection.runSection && !projection.toolSummarySection && !projection.conversationApprovalSection && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoToolActivity')}</div>
      )}

      {projection.delegatedWorkSection && (
        <div className="space-y-3">
          {/* Sub Agent progress bar */}
          <div className="space-y-1.5 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-3">
            <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
              <span>{t('taskPanel.subagentProgress')}</span>
              <span>{t('taskPanel.subagentProgressCount', {
                done: projection.delegatedWorkSection.progress.completedCount,
                total: projection.delegatedWorkSection.progress.total,
              })}</span>
            </div>
            {/* [P1-A] motion-reduce on progress transition */}
            <div
              role="progressbar"
              aria-valuenow={projection.delegatedWorkSection.progress.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('taskPanel.subagentProgress')}
              className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-app)] border border-[var(--color-border)]/40"
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${projection.delegatedWorkSection.progress.percentage}%` }}
              />
            </div>
          </div>

          {/* Synthesis indicator */}
          {projection.delegatedWorkSection.synthesisText && (
            // [P1-A] motion-reduce on both pulse and spin
            <div aria-live="polite" className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/15 px-3 py-2 text-xs text-[var(--color-accent)] font-medium animate-pulse motion-reduce:animate-none">
              <Loader className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{projection.delegatedWorkSection.synthesisText}</span>
            </div>
          )}

          {/* Activity Trail — Agent orchestration timeline (D-05: newest first) */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
              {t('taskPanel.delegatedTasksTitle')}
            </h3>
            <div className="relative">
              {/* Vertical timeline rail */}
              {projection.delegatedWorkSection.tasks.length > 1 && (
                <div
                  className="absolute left-2 top-3 bottom-3 w-px bg-[var(--color-border)]"
                  aria-hidden="true"
                />
              )}
              <div className="space-y-0">
                {projection.delegatedWorkSection.tasks.map((item) => (
                  <DelegatedTaskCard
                    key={item.task.taskId}
                    item={item}
                    onSelect={() => setViewingSubagent(item.task.taskId)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!projection.delegatedWorkSection && projection.runSection && !projection.toolSummarySection && !projection.conversationApprovalSection && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoDelegatedTasks')}</div>
      )}

      <ParallelBatchSection section={projection.parallelWorkSection} />

    </>
  );
}

export function TaskPanel({ isOpen, onClose, embedded = false }: TaskPanelProps) {
  const { t } = useTranslation();
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animateActive, setAnimateActive] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const animTimer = setTimeout(() => setAnimateActive(true), 10);
      return () => clearTimeout(animTimer);
    } else {
      setAnimateActive(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <aside
      aria-label={t('taskPanel.title')}
      className={`${embedded
        ? 'h-full w-[360px] min-w-[300px] max-w-[440px] border-l'
        : 'w-[360px] max-h-[70vh] rounded-[var(--radius-lg)] border'
      } bg-[var(--color-bg-surface)] border-[var(--color-border)] flex flex-col overflow-hidden origin-top-right transition-[opacity,transform] duration-200 ease-in-out ${
        animateActive
          ? 'opacity-100 scale-100 pointer-events-auto'
          : 'opacity-0 scale-[0.98] pointer-events-none'
      }`}
    >
      <div className="flex min-h-10 items-center justify-between px-4 border-b border-[var(--color-border)] shrink-0 select-none">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('taskPanel.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        <TaskPanelContent isOpen={isOpen} />
      </div>
    </aside>
  );
}
