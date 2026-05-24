import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, CircleAlert, Clock, Loader, ShieldAlert, XCircle } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import type { AgentRunStatus } from '../../../../shared/types';

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

export function TaskPanel({ isOpen, onClose, width, onResize }: TaskPanelProps) {
  const [isResizing, setIsResizing] = useState(false);
  const [editedArgs, setEditedArgs] = useState('');
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
    if (pendingApproval?.actions[0]) {
      setEditedArgs(JSON.stringify(pendingApproval.actions[0].args || {}, null, 2));
    }
  }, [pendingApproval]);

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
          <div className="rounded-lg border border-[var(--color-warning)]/50 bg-[var(--color-warning-dim)]/10 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
              <ShieldAlert className="w-4 h-4 text-[var(--color-warning)]" />
              等待人工审批
            </div>
            {pendingApproval.actions.map((action, index) => (
              <div key={`${action.name}-${index}`} className="space-y-1">
                <div className="text-xs font-medium text-[var(--color-text-primary)]">{action.name}</div>
                {action.description && (
                  <div className="text-[11px] text-[var(--color-text-muted)]">{action.description}</div>
                )}
              </div>
            ))}
            <textarea
              value={editedArgs}
              onChange={(e) => setEditedArgs(e.target.value)}
              className="w-full min-h-[100px] rounded border border-[var(--color-border)] bg-[var(--color-bg-app)] p-2 text-[11px] font-mono text-[var(--color-text-primary)]"
            />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className="btn btn-primary text-xs" onClick={() => resolveApproval('approve')}>
                允许
              </button>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => resolveApproval('edit', editedArgs)}>
                修改参数
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
