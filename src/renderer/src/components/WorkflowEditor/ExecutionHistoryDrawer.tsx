import { useEffect, useState } from 'react';
import { X, History, Download, Trash2, Clock, CheckCircle2, XCircle, Square, Loader2, FileJson } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '../../stores/workflowStore';

// 复用 ExecutionPanel 的状态样式（避免循环依赖）
const statusConfig: Record<string, { icon: typeof Clock; color: string }> = {
  pending: { icon: Clock, color: 'text-[var(--color-text-muted)]' },
  running: { icon: Loader2, color: 'text-[var(--color-info)]' },
  completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]' },
  failed: { icon: XCircle, color: 'text-[var(--color-danger)]' },
  stopped: { icon: Square, color: 'text-[var(--color-text-muted)]' },
};

function formatRelativeTime(ts: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return t('workflow.history.justNow');
  if (diff < 3600000) return t('workflow.history.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return t('workflow.history.hoursAgo', { count: Math.floor(diff / 3600000) });
  return t('workflow.history.daysAgo', { count: Math.floor(diff / 86400000) });
}

function formatDuration(start: number, end?: number): string {
  if (!end) return '-';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  workflowId: string;
  onClose: () => void;
}

export function ExecutionHistoryDrawer({ workflowId, onClose }: Props) {
  const { t } = useTranslation();
  const { historyExecutions, fetchHistoryExecutions, deleteHistoryExecution, exportHistoryExecution } = useWorkflowStore();
  const currentExecutionStatus = useWorkflowStore((s) => s.currentExecution?.status);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const statusLabelMap: Record<string, string> = {
    pending: t('workflow.execution.statusPending'),
    running: t('workflow.execution.statusRunning'),
    completed: t('workflow.execution.statusCompleted'),
    failed: t('workflow.execution.statusFailed'),
    stopped: t('workflow.execution.statusStopped'),
  };
  const triggerLabelMap: Record<string, string> = {
    editor: t('workflow.history.triggerEditor'),
    chat: t('workflow.history.triggerChat'),
    schedule: t('workflow.history.triggerSchedule'),
  };

  useEffect(() => {
    fetchHistoryExecutions(workflowId);
  }, [workflowId, fetchHistoryExecutions]);

  // 工作流跑完时(currentExecution 进入终态)自动刷新列表
  useEffect(() => {
    if (currentExecutionStatus && ['completed', 'failed', 'stopped'].includes(currentExecutionStatus)) {
      fetchHistoryExecutions(workflowId);
    }
  }, [currentExecutionStatus, workflowId, fetchHistoryExecutions]);

  const handleDelete = async (executionId: string) => {
    if (confirmingId !== executionId) {
      setConfirmingId(executionId);
      // 3 秒后自动取消二次确认
      setTimeout(() => setConfirmingId((cur) => (cur === executionId ? null : cur)), 3000);
      return;
    }
    setConfirmingId(null);
    try {
      await deleteHistoryExecution(executionId, workflowId);
    } catch (err) {
      // 错误已写入 store;UI 静默
    }
  };

  const handleExport = async (executionId: string) => {
    const result = await exportHistoryExecution(executionId);
    if (result.error) {
      alert(t('workflow.history.exportFailed', { error: result.error }));
    }
  };

  return (
    <div className="w-[380px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('workflow.history.title')}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {historyExecutions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)] text-xs gap-2">
            <FileJson className="w-8 h-8 opacity-40" />
            <span>{t('workflow.history.empty')}</span>
            <span className="text-[10px]">{t('workflow.history.emptyHint')}</span>
          </div>
        ) : (
          historyExecutions.map((exec) => {
            const config = statusConfig[exec.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const isRunning = exec.status === 'running';
            const isConfirming = confirmingId === exec.id;
            return (
              <div key={exec.id} className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-surface)] p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <StatusIcon className={`w-3.5 h-3.5 ${config.color} ${isRunning ? 'animate-spin' : ''} shrink-0`} />
                    <span className={`text-xs font-medium ${config.color}`}>{statusLabelMap[exec.status] || exec.status}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{triggerLabelMap[exec.trigger_source] || exec.trigger_source}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleExport(exec.id)}
                      className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                      title={t('workflow.history.downloadJson')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(exec.id)}
                      className={`p-1 rounded transition-all cursor-pointer ${isConfirming ? 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]' : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]'}`}
                      title={isConfirming ? t('workflow.history.confirmDeleteAgain') : t('workflow.history.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                  <span title={new Date(exec.started_at).toLocaleString()}>{formatRelativeTime(exec.started_at, t)}</span>
                  <span>{formatDuration(exec.started_at, exec.ended_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
