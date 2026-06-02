import { useEffect, useState } from 'react';
import { X, History, Download, Trash2, Clock, CheckCircle2, XCircle, Square, Loader2, FileJson } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';

// 复用 ExecutionPanel 的状态样式（避免循环依赖）
const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-[var(--color-text-muted)]', label: '等待中' },
  running: { icon: Loader2, color: 'text-[var(--color-info)]', label: '运行中' },
  completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]', label: '已完成' },
  failed: { icon: XCircle, color: 'text-[var(--color-danger)]', label: '失败' },
  stopped: { icon: Square, color: 'text-[var(--color-text-muted)]', label: '已停止' },
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function formatDuration(start: number, end?: number): string {
  if (!end) return '-';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const triggerLabel: Record<string, string> = { editor: '编辑器', chat: '对话', schedule: '定时' };

interface Props {
  workflowId: string;
  onClose: () => void;
}

export function ExecutionHistoryDrawer({ workflowId, onClose }: Props) {
  const { historyExecutions, fetchHistoryExecutions, deleteHistoryExecution, exportHistoryExecution } = useWorkflowStore();
  const currentExecutionStatus = useWorkflowStore((s) => s.currentExecution?.status);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
      alert(`导出失败: ${result.error}`);
    }
  };

  return (
    <div className="w-[380px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">历史执行记录</span>
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
            <span>暂无历史执行记录</span>
            <span className="text-[10px]">运行工作流后将在此显示</span>
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
                    <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{triggerLabel[exec.trigger_source] || exec.trigger_source}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleExport(exec.id)}
                      className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                      title="下载 JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(exec.id)}
                      className={`p-1 rounded transition-all cursor-pointer ${isConfirming ? 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]' : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-danger)]'}`}
                      title={isConfirming ? '再次点击确认删除' : '删除'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                  <span title={new Date(exec.started_at).toLocaleString()}>{formatRelativeTime(exec.started_at)}</span>
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
