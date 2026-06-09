import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, CircleAlert, Clock, FileText, Loader, ShieldAlert, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useSessionStore, type DelegatedTask } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentApprovalAction, AgentRunStatus } from '../../../../shared/types';

export interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
}

function RunStatusIcon({ status }: { status?: AgentRunStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
    case 'aborted':
      return <CircleAlert className="w-4 h-4 text-[var(--color-text-muted)]" />;
    case 'waiting_approval':
      return <ShieldAlert className="w-4 h-4 text-[var(--color-warning)]" />;
    default:
      return <Loader className="w-4 h-4 animate-spin text-[var(--color-accent)]" />;
  }
}

function DelegatedTaskStatusIcon({ status }: { status: 'running' | 'success' | 'failure' }) {
  switch (status) {
    case 'running':
      return <Loader className="w-4 h-4 animate-spin text-[var(--color-accent)]" />;
    case 'success':
      return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />;
    case 'failure':
      return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
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

function TaskPanelContent({ expandedTasks, setExpandedTasks }: {
  expandedTasks: Record<string, boolean>;
  setExpandedTasks: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeRunId = useSessionStore((state) => state.activeRunId);
  const agentRuns = useSessionStore((state) => state.agentRuns);
  const agentToolCalls = useSessionStore((state) => state.agentToolCalls);
  const delegatedTasks = useSessionStore((state) => state.delegatedTasks);
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const fetchAgentActivity = useSessionStore((state) => state.fetchAgentActivity);
  const resolveApproval = useSessionStore((state) => state.resolveApproval);
  const [, setTick] = useState(0);
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

  const isTaskExpanded = (taskId: string, status: string) => {
    if (expandedTasks[taskId] !== undefined) {
      return expandedTasks[taskId];
    }
    return status === 'running';
  };

  const toggleTaskExpand = (taskId: string, status: string) => {
    setExpandedTasks((prev) => ({
      ...prev,
      [taskId]: !isTaskExpanded(taskId, status),
    }));
  };

  const hasRunningTask = delegatedTasks.some((task) => task.status === 'running');
  useEffect(() => {
    if (!hasRunningTask) return;
    const timer = setInterval(() => {
      setTick((tick) => tick + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [hasRunningTask]);

  const getElapsedTimeText = (startedAt?: number, completedAt?: number) => {
    if (!startedAt) return null;
    const end = completedAt ?? Date.now();
    const seconds = Math.max(0, Math.round((end - startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const getAgentName = (task: DelegatedTask) => {
    const matched = agents.find((agent) => (agent as { slug?: string }).slug === task.agentSlug || agent.name === task.agentSlug);
    return matched ? matched.name : (task.agentName || task.agentSlug);
  };

  const activeRun = useMemo(() => agentRuns.find((run) => run.id === activeRunId) || agentRuns[0] || null, [activeRunId, agentRuns]);

  const toolSummary = useMemo(() => {
    const calls = agentToolCalls ?? [];
    const total = calls.length;
    const running = calls.filter((toolCall) => toolCall.status === 'running').length;
    const failed = calls.filter((toolCall) => toolCall.status === 'error');
    return {
      total,
      running,
      failed,
    };
  }, [agentToolCalls]);

  useEffect(() => {
    if (!activeSessionId) return;
    fetchAgentActivity(activeSessionId).catch(() => undefined);
  }, [activeSessionId, fetchAgentActivity]);

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
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
              <Clock className="w-3 h-3" />
              <span>{new Date(activeRun.started_at).toLocaleTimeString()}</span>
            </div>
            {activeRun.error && (
              <div className="text-xs text-[var(--color-danger)] whitespace-pre-wrap">{activeRun.error}</div>
            )}
          </div>
        )}

        {activeRun && toolSummary.total > 0 && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">{t('taskPanel.toolSummaryTitle')}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.total}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">{t('taskPanel.toolSummaryTotal')}</div>
              </div>
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.running}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">{t('taskPanel.toolSummaryRunning')}</div>
              </div>
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-danger)]">{toolSummary.failed.length}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">{t('taskPanel.toolSummaryFailed')}</div>
              </div>
            </div>
            {toolSummary.failed.slice(0, 3).map((toolCall) => (
              <div key={toolCall.id} className="text-[11px] text-[var(--color-danger)]">
                {toolCall.tool_name}: {toolCall.error || t('taskPanel.toolCallFailed')}
              </div>
            ))}
          </div>
        )}

        {pendingApproval && (
          <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-bg-surface)] p-3 shadow-sm space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-warning-dim)]/20 text-[var(--color-warning)]">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('taskPanel.approvalTitle')}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {pendingApproval.actions.length > 1 ? t('taskPanel.approvalActionsMultiple', { count: pendingApproval.actions.length }) : t('taskPanel.approvalActionsSingle')}
                </div>
              </div>
            </div>
            {pendingApproval.actions.map((action, index) => (
              <div key={`${action.name}-${index}`} className="space-y-2 border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
                {(() => {
                  const summary = getApprovalSummary(action, t);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
                          <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{summary.title}</span>
                        </div>
                        <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                          {action.name}
                        </span>
                      </div>
                      {summary.target && (
                        <div className="bg-[var(--color-bg-app)] px-2 py-1.5">
                          <div className="text-[10px] text-[var(--color-text-muted)]">{t('taskPanel.approvalTarget')}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-text-primary)]">{summary.target}</div>
                        </div>
                      )}
                      {summary.preview && (
                        <div className="bg-[var(--color-bg-app)] px-2 py-1.5">
                          <div className="text-[10px] text-[var(--color-text-muted)]">{summary.previewLabel}</div>
                          <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-text-primary)]">
                            {summary.preview}
                          </pre>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-primary text-xs" onClick={() => resolveApproval('approve')}>
                {t('common.approve')}
              </button>
              <button type="button" className="btn btn-secondary text-xs text-[var(--color-danger)]" onClick={() => resolveApproval('reject')}>
                {t('common.reject')}
              </button>
            </div>
          </div>
        )}

        {activeRun && toolSummary.total === 0 && !pendingApproval && (
          <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoToolActivity')}</div>
        )}

        {delegatedTasks.length > 0 && (() => {
          const total = delegatedTasks.length;
          const completedCount = delegatedTasks.filter(t => t.status === 'success' || t.status === 'failure').length;
          const percentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;
          const allSubagentsComplete = total > 0 && delegatedTasks.every(t => t.status === 'success' || t.status === 'failure');
          const isMasterRunning = activeRun && activeRun.status === 'running';

          return (
            <div className="space-y-3">
              {/* Subagent Progress Bar */}
              <div className="space-y-1.5 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-3">
                <div className="flex items-center justify-between text-[11px] font-medium text-[var(--color-text-secondary)]">
                  <span>{t('taskPanel.subagentProgress')}</span>
                  <span>{t('taskPanel.subagentProgressCount', { done: completedCount, total })}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-app)] border border-[var(--color-border)]/40">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>

              {/* Synthesis Indicator */}
              {allSubagentsComplete && isMasterRunning && (
                <div className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/15 px-3 py-2 text-[11px] text-[var(--color-accent)] font-medium animate-pulse">
                  <Loader className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('taskPanel.synthesizing', { count: total })}</span>
                </div>
              )}

              <div className="text-xs font-semibold text-[var(--color-text-primary)]">{t('taskPanel.delegatedTasksTitle')}</div>
              {delegatedTasks.map((task) => {
                const expanded = isTaskExpanded(task.taskId, task.status);
                const duration = getElapsedTimeText(task.startedAt, task.completedAt);
                return (
                  <div
                    key={task.taskId}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2"
                  >
                    {/* Collapsible Card Header */}
                    <div
                      onClick={() => toggleTaskExpand(task.taskId, task.status)}
                      className="flex items-center justify-between cursor-pointer select-none group/hdr"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {expanded ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)] group-hover/hdr:text-[var(--color-text-secondary)] transition-colors" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)] group-hover/hdr:text-[var(--color-text-secondary)] transition-colors" />
                        )}
                        <DelegatedTaskStatusIcon status={task.status} />
                        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                          {getAgentName(task)}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--color-text-muted)] truncate max-w-[80px]">
                          {task.agentSlug}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {duration && (
                          <span className="text-[10px] text-[var(--color-text-muted)] font-medium">
                            {duration}
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          task.status === 'running'
                            ? 'bg-blue-500/10 text-blue-500 border border-blue-500/25'
                            : task.status === 'success'
                              ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25'
                              : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/25'
                        }`}>
                          {task.status === 'running' ? t('taskPanel.statusRunning') : task.status === 'success' ? t('taskPanel.statusCompleted') : t('taskPanel.statusFailed')}
                        </span>
                      </div>
                    </div>

                    {/* Collapsible Card Body */}
                    {expanded && (
                      <div className="space-y-2 mt-2 pt-2 border-t border-[var(--color-border)]/50">
                        {task.goal && (
                          <div className="text-[11px] text-[var(--color-text-secondary)] font-normal leading-relaxed">
                            <span className="font-semibold text-[var(--color-text-muted)] mr-1">{t('taskPanel.taskGoal')}:</span>
                            {task.goal}
                          </div>
                        )}

                        {/* Monospaced Log Console */}
                        <div className="rounded-md bg-[var(--color-bg-app)] border border-[var(--color-border)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-text-primary)] overflow-x-auto whitespace-pre-wrap break-words max-h-36 overflow-y-auto">
                          {task.status === 'running' ? (
                            <>
                              {task.chunks.length > 0 ? task.chunks.join('') : t('taskPanel.subagentInitializing')}
                              <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--color-accent)] animate-pulse align-middle" />
                            </>
                          ) : task.status === 'failure' ? (
                            <div className="text-[var(--color-danger)] space-y-1">
                              <div>{t('taskPanel.taskFailed', { code: task.errorCode })}</div>
                              {task.result?.error?.message && <div className="text-[10px] opacity-90 leading-normal">{task.result.error.message}</div>}
                            </div>
                          ) : (
                            task.result?.summary || t('taskPanel.taskCompleted')
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {delegatedTasks.length === 0 && activeRun && toolSummary.total === 0 && !pendingApproval && (
          <div className="text-xs text-[var(--color-text-muted)]">{t('taskPanel.emptyNoDelegatedTasks')}</div>
        )}
    </>
  );
}

export function TaskPanel({ isOpen, onClose, width, onResize }: TaskPanelProps) {
  const { t } = useTranslation();
  const [isResizing, setIsResizing] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

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
        isResizing ? '' : 'transition-all duration-300 ease-in-out'
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
            className={`absolute left-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize z-50 bg-transparent hover:bg-[var(--color-accent)]/40 transition-colors duration-150 ${isResizing ? 'bg-[var(--color-accent)]/80' : ''}`}
          />

          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] h-[57px] shrink-0 select-none">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('taskPanel.title')}</span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <TaskPanelContent expandedTasks={expandedTasks} setExpandedTasks={setExpandedTasks} />
          </div>
        </>
      )}
    </aside>
  );
}
