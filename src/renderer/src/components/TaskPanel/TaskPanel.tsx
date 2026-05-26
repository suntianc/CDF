import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, CircleAlert, Clock, FileText, Loader, ShieldAlert, XCircle } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import type { AgentApprovalAction, AgentRunStatus } from '../../../../shared/types';

interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
}

const statusLabel: Record<AgentRunStatus, string> = {
  running: '运行中',
  waiting_approval: '等待审批',
  completed: '已完成',
  failed: '失败',
  aborted: '已中断',
};

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

const toolLabels: Record<string, string> = {
  write_file: '写入文件',
  edit_file: '编辑文件',
  delete_file: '删除文件',
};

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

function getApprovalSummary(action: AgentApprovalAction) {
  const args = toRecord(action.args);
  const target = toDisplayText(args.file_path || args.path || args.target || args.command);
  const preview = toDisplayText(args.content || args.new_string || args.old_string || args.input);
  const previewLabel = args.content
    ? '写入内容'
    : args.new_string
      ? '新内容'
      : args.old_string
        ? '匹配内容'
        : '参数摘要';

  return {
    title: toolLabels[action.name] || action.name,
    target,
    preview: clipText(preview),
    previewLabel,
  };
}

export function TaskPanel({ isOpen, onClose, width, onResize }: TaskPanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const {
    activeSessionId,
    activeRunId,
    agentRuns,
    agentToolCalls,
    pendingApproval,
    fetchAgentActivity,
    resolveApproval,
  } = useSessionStore();

  const activeRun = useMemo(() => {
    return agentRuns.find((run) => run.id === activeRunId) || agentRuns[0] || null;
  }, [activeRunId, agentRuns]);

  const toolSummary = useMemo(() => {
    const total = agentToolCalls.length;
    const running = agentToolCalls.filter((toolCall) => toolCall.status === 'running').length;
    const failed = agentToolCalls.filter((toolCall) => toolCall.status === 'error');
    return {
      total,
      running,
      failed,
    };
  }, [agentToolCalls]);

  useEffect(() => {
    if (!activeSessionId || !isOpen) return;
    fetchAgentActivity(activeSessionId);
  }, [activeSessionId, fetchAgentActivity, isOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
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
      className={`
        h-full bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]
        flex flex-col relative shrink-0
        ${isResizing ? '' : 'transition-all duration-300 ease-in-out'}
        ${isOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'}
      `}
      style={{ width: isOpen ? width : 0 }}
    >
      <div
        onMouseDown={handleMouseDown}
        className={`absolute left-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize z-50 bg-transparent hover:bg-[var(--color-accent)]/40 transition-colors duration-150 ${isResizing ? 'bg-[var(--color-accent)]/80' : ''}`}
      />

      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] h-[57px] shrink-0 select-none">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Agent 活动</span>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {!activeSessionId && (
          <div className="text-xs text-[var(--color-text-muted)]">选择或创建会话后查看 Agent 活动。</div>
        )}

        {activeSessionId && !activeRun && (
          <div className="text-xs text-[var(--color-text-muted)]">当前会话暂无运行记录。</div>
        )}

        {activeRun && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <RunStatusIcon status={activeRun.status} />
              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                {statusLabel[activeRun.status]}
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
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">工具摘要</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.total}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">总数</div>
              </div>
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{toolSummary.running}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">运行中</div>
              </div>
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] px-2 py-1.5">
                <div className="text-sm font-semibold text-[var(--color-danger)]">{toolSummary.failed.length}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">失败</div>
              </div>
            </div>
            {toolSummary.failed.slice(0, 3).map((toolCall) => (
              <div key={toolCall.id} className="text-[11px] text-[var(--color-danger)]">
                {toolCall.tool_name}: {toolCall.error || '工具调用失败'}
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
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">等待人工审批</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {pendingApproval.actions.length > 1 ? `${pendingApproval.actions.length} 个操作等待确认` : '1 个操作等待确认'}
                </div>
              </div>
            </div>
            {pendingApproval.actions.map((action, index) => (
              <div key={`${action.name}-${index}`} className="space-y-2 border-t border-[var(--color-border)] pt-3 first:border-t-0 first:pt-0">
                {(() => {
                  const summary = getApprovalSummary(action);
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
                          <div className="text-[10px] text-[var(--color-text-muted)]">目标</div>
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
                允许
              </button>
              <button type="button" className="btn btn-secondary text-xs text-[var(--color-danger)]" onClick={() => resolveApproval('reject')}>
                拒绝
              </button>
            </div>
          </div>
        )}

        {activeRun && toolSummary.total === 0 && !pendingApproval && (
          <div className="text-xs text-[var(--color-text-muted)]">本轮暂无需要关注的工具活动。</div>
        )}
      </div>
    </aside>
  );
}
