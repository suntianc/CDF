import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { WorkflowStreamEvent, WorkflowNodeRun, WorkflowExecutionStatus } from '../../../../shared/types';
import { X, Square, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface ExecutionPanelProps {
  executionId: string;
  onClose: () => void;
}

const statusConfig: Record<string, { icon: typeof Loader2; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-[var(--color-text-muted)]', label: '等待中' },
  running: { icon: Loader2, color: 'text-[var(--color-info)]', label: '运行中' },
  completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]', label: '已完成' },
  failed: { icon: XCircle, color: 'text-[var(--color-danger)]', label: '失败' },
  stopped: { icon: Square, color: 'text-[var(--color-text-muted)]', label: '已停止' },
  skipped: { icon: AlertTriangle, color: 'text-[var(--color-warning)]', label: '已跳过' },
};

export function ExecutionPanel({ executionId, onClose }: ExecutionPanelProps) {
  const { subscribeToExecution, nodeRuns, fetchNodeRuns, stopWorkflow, currentExecution } = useWorkflowStore();
  const [executionStatus, setExecutionStatus] = useState<WorkflowExecutionStatus>('running');

  useEffect(() => {
    if (!executionId) return;

    fetchNodeRuns(executionId);
    const unsubscribe = subscribeToExecution(executionId);

    return () => {
      unsubscribe();
    };
  }, [executionId, fetchNodeRuns, subscribeToExecution]);

  useEffect(() => {
    if (currentExecution?.status) {
      setExecutionStatus(currentExecution.status);
    }
  }, [currentExecution?.status]);

  const handleStop = async () => {
    await stopWorkflow(executionId);
  };

  const formatDuration = (startedAt: number, endedAt?: number) => {
    const end = endedAt || Date.now();
    const ms = end - startedAt;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const isRunning = executionStatus === 'running';
  const StatusIcon = statusConfig[executionStatus]?.icon || Clock;
  const statusColor = statusConfig[executionStatus]?.color || 'text-[var(--color-text-muted)]';
  const statusLabel = statusConfig[executionStatus]?.label || executionStatus;

  return (
    <div className="w-[320px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${statusColor} ${isRunning ? 'animate-spin' : ''}`} />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">执行状态</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 border-b border-[var(--color-border)]/30 flex items-center justify-between">
        <span className={`text-xs font-medium ${statusColor}`}>
          {statusLabel}
        </span>
        {isRunning && (
          <button
            className="btn btn-danger btn-sm cursor-pointer text-[11px] py-1 px-2"
            onClick={handleStop}
          >
            <Square className="w-3 h-3" />
            停止
          </button>
        )}
      </div>

      {/* Node Runs List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {nodeRuns.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)] text-center py-8">
            {isRunning ? '等待节点执行...' : '暂无执行记录'}
          </div>
        ) : (
          <div className="space-y-2">
            {nodeRuns.map((run) => {
              const config = statusConfig[run.status] || statusConfig.pending;
              const RunIcon = config.icon;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-surface)] p-3"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <RunIcon
                        className={`w-3.5 h-3.5 ${config.color} ${run.status === 'running' ? 'animate-spin' : ''}`}
                      />
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        {run.node_name}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {formatDuration(run.started_at, run.ended_at)}
                    </span>
                  </div>
                  {run.error && (
                    <div className="mt-1 text-[11px] text-[var(--color-danger)] bg-[var(--color-danger-dim)] rounded px-2 py-1">
                      {run.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
