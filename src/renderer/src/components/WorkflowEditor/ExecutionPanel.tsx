import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { WorkflowExecution, WorkflowExecutionStatus } from '../../../../shared/types';
import { X, Square, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle, PackageOpen, Target } from 'lucide-react';

interface ExecutionPanelProps {
  executionId: string;
  taskGoal?: string;
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

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractNodeArtifact(output: unknown): string {
  if (!output || typeof output !== 'object') return formatJson(output);
  const record = output as Record<string, unknown>;
  if (typeof record.result === 'string') return record.result;
  return formatJson(output);
}

export function ExecutionPanel({ executionId, taskGoal, onClose }: ExecutionPanelProps) {
  const { subscribeToExecution, nodeRuns, fetchNodeRuns, stopWorkflow, currentExecution, nodeLogs } = useWorkflowStore();
  const [executionStatus, setExecutionStatus] = useState<WorkflowExecutionStatus>('running');
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);

  useEffect(() => {
    if (!executionId) return;

    fetchNodeRuns(executionId);
    const unsubscribe = subscribeToExecution(executionId);
    window.electronAPI.db.getWorkflowExecution(executionId)
      .then((value) => setExecution(value || null))
      .catch(() => {});

    return () => {
      unsubscribe();
    };
  }, [executionId, fetchNodeRuns, subscribeToExecution]);

  useEffect(() => {
    if (currentExecution?.status) {
      setExecutionStatus(currentExecution.status);
      if (currentExecution.status !== 'running') {
        window.electronAPI.db.getWorkflowExecution(executionId)
          .then((value) => setExecution(value || null))
          .catch(() => {});
      }
    }
  }, [currentExecution?.status, executionId]);

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
    <div className="w-[380px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 flex flex-col shrink-0 execution-panel-container">
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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {(taskGoal || execution?.input?.taskGoal) && (
          <div className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-surface)] p-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">任务目标</span>
            </div>
            <div className="text-[11px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">
              {String(taskGoal || execution?.input?.taskGoal)}
            </div>
          </div>
        )}

        {nodeRuns.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)] text-center py-8">
            {isRunning ? '等待节点执行...' : '暂无执行记录'}
          </div>
        ) : (
          <div className="space-y-2">
            {nodeRuns.map((run) => {
              const config = statusConfig[run.status] || statusConfig.pending;
              const RunIcon = config.icon;
              const logs = nodeLogs[run.node_id];
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

                  {/* Logs Console */}
                  {logs && logs.length > 0 && (
                    <div className="mt-2 border-t border-[var(--color-border)]/20 pt-2">
                      <div className="text-[9px] font-semibold text-[var(--color-text-muted)] mb-1">
                        运行日志
                      </div>
                      <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap rounded bg-black/15 p-2 font-mono text-[9px] leading-relaxed text-[var(--color-text-secondary)] space-y-0.5">
                        {logs.map((logLine, idx) => (
                          <div key={idx} className="border-b border-black/5 pb-0.5 last:border-b-0 last:pb-0">
                            {logLine}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {run.output && (
                    <details className="mt-2 group">
                      <summary className="cursor-pointer text-[11px] font-medium text-[var(--color-accent)]">
                        查看节点产物
                      </summary>
                      <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                        {extractNodeArtifact(run.output)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {execution?.output && Object.keys(execution.output).length > 0 && (
          <div className="rounded-lg border border-[var(--color-success)]/20 bg-[var(--color-success-dim)]/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <PackageOpen className="w-3.5 h-3.5 text-[var(--color-success)]" />
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">工作流产物</span>
            </div>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
              {formatJson(execution.output)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
