import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ChevronRight, CircleAlert, Clock, FileText, Loader, ShieldAlert, XCircle } from 'lucide-react';
// ChevronDown/ChevronRight/ExternalLink removed — sub-agent detail now renders in ChatArea
import { useSessionStore, estimateTokens } from '../../stores/sessionStore';
import type { DelegatedTask } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentApprovalAction, AgentRunStatus } from '../../../../shared/types';

export interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clipText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function getApprovalSummary(action: AgentApprovalAction, t: (key: string) => string) {
  const args = toRecord(action.args);
  const target = toDisplayText(args.file_path || args.path || args.target || args.command);
  const preview = toDisplayText(args.content || args.new_string || args.old_string || args.input);
  const previewLabel = args.content
    ? t('taskPanel.approvalPreviewWrite')
    : args.new_string
      ? t('taskPanel.approvalPreviewNew')
      : args.old_string
        ? t('taskPanel.approvalPreviewMatch')
        : t('taskPanel.approvalPreviewArgs');

  const toolLabels: Record<string, string> = {
    write_file: t('taskPanel.toolWriteFile'),
    edit_file: t('taskPanel.toolEditFile'),
    delete_file: t('taskPanel.toolDeleteFile'),
  };

  return {
    title: toolLabels[action.name] || action.name,
    target,
    preview: clipText(preview),
    previewLabel,
  };
}

function ApprovalActionCard({ action }: { action: AgentApprovalAction }) {
  const { t } = useTranslation();
  const summary = getApprovalSummary(action, t);
  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
          <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{summary.title}</span>
        </div>
        {/* [P1-B] 10px → 11px secondary for WCAG AA contrast */}
        <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
          {action.name}
        </span>
      </div>
      {summary.target && (
        <div className="bg-[var(--color-bg-app)] px-2 py-1.5">
          <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.approvalTarget')}</div>
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

function DelegatedTaskCard({ task, agentName, isActive, onSelect }: {
  task: DelegatedTask;
  agentName: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isRunning = task.status === 'running';
  const isFailure = task.status === 'failure';

  const statusText = isRunning
    ? t('taskPanel.statusRunning')
    : isFailure
      ? t('taskPanel.statusFailed')
      : t('taskPanel.statusCompleted');

  const totalText = useMemo(
    () => task.chunks.length > 0 ? task.chunks.join('') : (task.result?.summary || ''),
    [task.chunks, task.result?.summary],
  );
  const tokenEstimate = useMemo(() => estimateTokens(totalText), [totalText]);
  const tokenDisplay = tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;

  const metricsText = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${tokenDisplay} ${t('taskPanel.tokenUnit')}`);
    if (!isRunning && task.startedAt) {
      const end = task.completedAt ?? Date.now();
      const s = Math.max(0, Math.round((end - task.startedAt) / 1000));
      parts.push(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
    }
    return parts.join(' · ');
  }, [tokenDisplay, isRunning, task.startedAt, task.completedAt, t]);

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
        aria-label={`${agentName} (${statusText})`}
        onClick={onSelect}
        className={`w-full text-left p-2.5 rounded-md border transition-all duration-150 ease-out focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none ${
          isActive
            ? 'bg-[var(--color-accent-dim)] border-[var(--color-accent)]/30 shadow-sm'
            : 'bg-[var(--color-bg-surface)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{agentName}</span>
          <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums whitespace-nowrap">
            <span>{metricsText}</span>
            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" aria-hidden="true" />
          </div>
        </div>
      </button>
    </div>
  );
}

function TaskPanelContent() {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeRunId = useSessionStore((state) => state.activeRunId);
  const agentRuns = useSessionStore((state) => state.agentRuns);
  const agentToolCalls = useSessionStore((state) => state.agentToolCalls);
  const delegatedTasks = useSessionStore((state) => state.delegatedTasks);
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const fetchAgentActivity = useSessionStore((state) => state.fetchAgentActivity);
  const resolveApproval = useSessionStore((state) => state.resolveApproval);
  const viewingSubagentId = useSessionStore((state) => state.viewingSubagentId);
  const setViewingSubagent = useSessionStore((state) => state.setViewingSubagent);
  const agents = useAgentStore((state) => state.agents);

  const statusLabel = (status: AgentRunStatus) => {
    switch (status) {
      case 'running': return t('taskPanel.statusRunning');
      case 'waiting_approval': return t('taskPanel.statusWaitingApproval');
      case 'completed': return t('taskPanel.statusCompleted');
      case 'failed': return t('taskPanel.statusFailed');
      case 'aborted': return t('taskPanel.statusAborted');
    }
  };

  const getAgentName = (task: DelegatedTask) => {
    const matched = agents.find((agent) => (agent as { slug?: string }).slug === task.agentSlug || agent.name === task.agentSlug);
    return matched ? matched.name : (task.agentName || task.agentSlug);
  };

  const activeRun = useMemo(() => agentRuns.find((run) => run.id === activeRunId) ?? null, [activeRunId, agentRuns]);

  // Master Agent tool call summary
  const toolSummary = useMemo(() => {
    const calls = agentToolCalls ?? [];
    const total = calls.length;
    const running = calls.filter((toolCall) => toolCall.status === 'running').length;
    const failed = calls.filter((toolCall) => toolCall.status === 'error');
    return { total, running, failed };
  }, [agentToolCalls]);

  useEffect(() => {
    if (!activeSessionId) return;
    fetchAgentActivity(activeSessionId).catch(() => undefined);
  }, [activeSessionId, fetchAgentActivity]);

  // D-05: Newest Sub Agent on top (sort by startedAt descending)
  const sortedTasks = useMemo(
    () => [...delegatedTasks].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
    [delegatedTasks],
  );

  return (
    <>
      {!activeSessionId && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoSession')}</div>
      )}

      {activeSessionId && !activeRun && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoRun')}</div>
      )}

      {activeRun && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <RunStatusIcon status={activeRun.status} />
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {statusLabel(activeRun.status)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{new Date(activeRun.started_at).toLocaleTimeString()}</span>
          </div>
          {activeRun.error && (
            <div className="text-xs text-[var(--color-danger)] whitespace-pre-wrap">{activeRun.error}</div>
          )}
        </div>
      )}

      {activeRun && toolSummary.total > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">{t('taskPanel.toolSummaryTitle')}</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.total}</div>
              {/* [P1-B] 10px → 11px secondary */}
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryTotal')}</div>
            </div>
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.running}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryRunning')}</div>
            </div>
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
              <div className="text-sm font-semibold text-[var(--color-danger)]">{toolSummary.failed.length}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">{t('taskPanel.toolSummaryFailed')}</div>
            </div>
          </div>
          {toolSummary.failed.slice(0, 3).map((toolCall) => {
            const errorText = toolCall.tool_name === 'task'
              ? t('taskPanel.subagentCallIntercepted')
              : (toolCall.error || t('taskPanel.toolCallFailed'));
            return (
              <div key={toolCall.id} className="text-xs text-[var(--color-danger)]">
                {toolCall.tool_name}: {errorText}
              </div>
            );
          })}
        </div>
      )}

      {pendingApproval && (
        <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-bg-surface)] p-3 shadow-sm space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-warning-dim)] text-[var(--color-warning)]">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              {/* [P2-G] div → h3 for proper heading hierarchy */}
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('taskPanel.approvalTitle')}</h3>
              {/* [P1-B] muted → secondary */}
              <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                {pendingApproval.actions.length > 1 ? t('taskPanel.approvalActionsMultiple', { count: pendingApproval.actions.length }) : t('taskPanel.approvalActionsSingle')}
              </div>
            </div>
          </div>
          <div id="pending-approval-actions" className="space-y-3 w-full">
            {pendingApproval.actions.map((action, index) => (
              <ApprovalActionCard key={`${action.name}-${index}`} action={action} />
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

      {activeRun && toolSummary.total === 0 && !pendingApproval && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoToolActivity')}</div>
      )}

      {sortedTasks.length > 0 && (() => {
        const total = sortedTasks.length;
        const completedCount = sortedTasks.filter(t => t.status === 'success' || t.status === 'failure').length;
        const percentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        const allSubagentsComplete = total > 0 && sortedTasks.every(t => t.status === 'success' || t.status === 'failure');
        const isMasterRunning = activeRun && activeRun.status === 'running';

        return (
          <div className="space-y-3">
            {/* Sub Agent progress bar */}
            <div className="space-y-1.5 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-3">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>{t('taskPanel.subagentProgress')}</span>
                <span>{t('taskPanel.subagentProgressCount', { done: completedCount, total })}</span>
              </div>
              {/* [P1-A] motion-reduce on progress transition */}
              <div
                role="progressbar"
                aria-valuenow={percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('taskPanel.subagentProgress')}
                className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-app)] border border-[var(--color-border)]/40"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Synthesis indicator */}
            {allSubagentsComplete && isMasterRunning && (
              // [P1-A] motion-reduce on both pulse and spin
              <div aria-live="polite" className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/15 px-3 py-2 text-xs text-[var(--color-accent)] font-medium animate-pulse motion-reduce:animate-none">
                <Loader className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <span>{t('taskPanel.synthesizing', { count: total })}</span>
              </div>
            )}

            {/* Activity Trail — Agent orchestration timeline (D-05: newest first) */}
            <div>
              <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-1.5">
                {t('taskPanel.delegatedTasksTitle')}
              </h3>
              <div className="relative">
                {/* Vertical timeline rail */}
                {sortedTasks.length > 1 && (
                  <div
                    className="absolute left-2 top-3 bottom-3 w-px bg-[var(--color-border)]"
                    aria-hidden="true"
                  />
                )}
                <div className="space-y-0">
                  {sortedTasks.map((task) => (
                    <DelegatedTaskCard
                      key={task.taskId}
                      task={task}
                      agentName={getAgentName(task)}
                      isActive={viewingSubagentId === task.taskId}
                      onSelect={() => setViewingSubagent(task.taskId)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {sortedTasks.length === 0 && activeRun && toolSummary.total === 0 && !pendingApproval && (
        <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoDelegatedTasks')}</div>
      )}

    </>
  );
}

export function TaskPanel({ isOpen, onClose, width, onResize }: TaskPanelProps) {
  const { t } = useTranslation();
  const [isResizing, setIsResizing] = useState(false);

  void onClose;

  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - event.clientX;
      const clampedWidth = Math.min(600, Math.max(300, newWidth));
      onResize(clampedWidth);
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
    return undefined;
  }, [isResizing, onResize]);

  return (
    <aside
      className={`h-full bg-[var(--color-bg-sidebar)] flex flex-col relative shrink-0 ${
        isResizing ? '' : 'transition-all duration-300 ease-in-out motion-reduce:transition-none'
      } ${
        isOpen
          ? 'border-l border-[var(--color-border)] opacity-100'
          : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'
      }`}
      style={{ width: isOpen ? width : 0 }}
    >
      {isOpen && (
        <>
          <div
            onMouseDown={handleMouseDown}
            className="absolute -left-6 top-0 bottom-0 w-11 cursor-col-resize z-50 flex justify-center"
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={width}
              aria-valuemin={300}
              aria-valuemax={600}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { onResize(Math.max(300, width - 40)); }
                if (e.key === 'ArrowRight') { onResize(Math.min(600, width + 40)); }
              }}
              className={`w-1.5 h-full transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 ${isResizing ? 'bg-[var(--color-accent)]/80' : 'hover:bg-[var(--color-accent)]/40'}`}
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] h-14 shrink-0 select-none">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('taskPanel.title')}</h2>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <TaskPanelContent />
          </div>
        </>
      )}
    </aside>
  );
}
