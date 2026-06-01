import { useEffect, useState, useRef } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { WorkflowExecution, WorkflowExecutionStatus } from '../../../../shared/types';
import {
  X,
  Square,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  PackageOpen,
  Target,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  File,
  ExternalLink,
  FolderOpen
} from 'lucide-react';

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

function parseLogLine(line: string) {
  if (line.includes('Agent 正在思考决策...')) {
    return {
      type: 'thinking',
      title: 'Agent 正在思考决策...',
    };
  }

  let match = line.match(/^\[工具调用\] 开始执行工具:\s*(.+?)，参数:\s*([\s\S]*)$/);
  if (match) {
    return {
      type: 'tool_call',
      tool: match[1],
      param: match[2],
    };
  }

  match = line.match(/^\[工具返回\] 工具\s*(.+?)\s*执行成功，结果:\s*([\s\S]*)$/);
  if (match) {
    return {
      type: 'tool_success',
      tool: match[1],
      result: match[2],
    };
  }

  match = line.match(/^\[工具失败\] 工具\s*(.+?)\s*执行失败，错误:\s*([\s\S]*)$/);
  if (match) {
    return {
      type: 'tool_fail',
      tool: match[1],
      error: match[2],
    };
  }

  return {
    type: 'info',
    content: line,
  };
}

function RenderLogLine({ line, isLatest, isNodeRunning }: { line: string; isLatest: boolean; isNodeRunning: boolean }) {
  const parsed = parseLogLine(line);
  if (parsed.type === 'thinking') {
    const showSpinner = isLatest && isNodeRunning;
    return (
      <div className="flex items-center gap-2 py-1 px-1.5 rounded bg-purple-500/5 text-purple-400 border border-purple-500/10 mb-1">
        {showSpinner && <Loader2 className="w-3 h-3 animate-spin" />}
        <span className="text-[10px] font-medium">{parsed.title}</span>
      </div>
    );
  }
  if (parsed.type === 'tool_call') {
    return (
      <div className="flex flex-col gap-1 py-1 px-1.5 rounded bg-[var(--color-info-dim)]/30 border border-[var(--color-info)]/10 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] px-1 py-0.2 rounded font-bold bg-[var(--color-info)]/20 text-[var(--color-info)]">调用</span>
          <span className="text-[9px] font-semibold text-[var(--color-text-primary)] font-mono">{parsed.tool}</span>
        </div>
        {parsed.param && (
          <pre className="text-[9px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap bg-black/10 p-1 rounded max-h-[80px] overflow-y-auto">
            {parsed.param}
          </pre>
        )}
      </div>
    );
  }
  if (parsed.type === 'tool_success') {
    return (
      <div className="flex flex-col gap-1 py-1 px-1.5 rounded bg-[var(--color-success-dim)]/30 border border-[var(--color-success)]/10 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] px-1 py-0.2 rounded font-bold bg-[var(--color-success)]/20 text-[var(--color-success)]">返回</span>
          <span className="text-[9px] font-semibold text-[var(--color-text-primary)] font-mono">{parsed.tool}</span>
        </div>
        {parsed.result && (
          <pre className="text-[9px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap bg-black/10 p-1 rounded max-h-[80px] overflow-y-auto">
            {parsed.result}
          </pre>
        )}
      </div>
    );
  }
  if (parsed.type === 'tool_fail') {
    return (
      <div className="flex flex-col gap-1 py-1 px-1.5 rounded bg-[var(--color-danger-dim)]/30 border border-[var(--color-danger)]/10 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] px-1 py-0.2 rounded font-bold bg-[var(--color-danger)]/20 text-[var(--color-danger)]">失败</span>
          <span className="text-[9px] font-semibold text-[var(--color-text-primary)] font-mono">{parsed.tool}</span>
        </div>
        {parsed.error && (
          <pre className="text-[9px] font-mono text-[var(--color-danger)] whitespace-pre-wrap bg-black/10 p-1 rounded max-h-[80px] overflow-y-auto">
            {parsed.error}
          </pre>
        )}
      </div>
    );
  }
  return (
    <div className="text-[9px] py-0.5 text-[var(--color-text-secondary)] pl-1 border-l border-[var(--color-border)]/50 font-mono mb-1">
      {parsed.content}
    </div>
  );
}

function detectFilesFromOutput(output: unknown): string[] {
  if (!output || typeof output !== 'object') return [];
  const record = output as Record<string, unknown>;
  const fileFields = ['file', 'files', 'filePath', 'outputPath', 'outputFile', 'output_file', 'output_files', 'path', 'paths'];
  const found: string[] = [];

  for (const field of fileFields) {
    const val = record[field];
    if (typeof val === 'string' && val.trim()) {
      found.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) {
          found.push(item.trim());
        }
      }
    }
  }

  if (typeof record.result === 'string') {
    const matches = record.result.match(/(?:[a-zA-Z0-9_\-\/]+\.[a-zA-Z0-9]+)/g);
    if (matches) {
      for (const m of matches) {
        if (!m.includes('_') && !/^\d+\.\d+$/.test(m) && m.length > 2) {
          found.push(m);
        }
      }
    }
  }

  return Array.from(new Set(found)).filter(f => {
    const lower = f.toLowerCase();
    return !lower.startsWith('http') && lower.includes('.') && !lower.endsWith('.js') && !lower.endsWith('.ts');
  });
}

function FileCard({ filePath, projectId }: { filePath: string; projectId?: string }) {
  const isCode = /\.(json|css|html|js|ts|py|go|rs|sh|yml|yaml)$/i.test(filePath);
  const isDoc = /\.(md|txt|pdf|docx|doc)$/i.test(filePath);
  const Icon = isCode ? FileCode : isDoc ? FileText : File;
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const handleOpen = async () => {
    const res = await window.electronAPI.db.openFile(filePath, projectId);
    if (!res.success) {
      alert(res.error || '无法打开文件');
    }
  };

  const handleReveal = async () => {
    const res = await window.electronAPI.db.revealFile(filePath, projectId);
    if (!res.success) {
      alert(res.error || '无法定位文件');
    }
  };

  return (
    <div className="flex items-center justify-between p-2 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[10px] gap-2 mb-1.5">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Icon className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
        <span className="truncate text-[var(--color-text-primary)] font-mono font-medium" title={filePath}>
          {fileName}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleOpen}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer flex items-center gap-0.5"
          title="打开文件"
        >
          <ExternalLink className="w-3 h-3" />
          <span>打开</span>
        </button>
        <button
          onClick={handleReveal}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer flex items-center gap-0.5"
          title="定位文件"
        >
          <FolderOpen className="w-3 h-3" />
          <span>定位</span>
        </button>
      </div>
    </div>
  );
}

export function ExecutionPanel({ executionId, taskGoal, onClose }: ExecutionPanelProps) {
  const { subscribeToExecution, nodeRuns, fetchNodeRuns, stopWorkflow, currentExecution, nodeLogs } = useWorkflowStore();
  const [executionStatus, setExecutionStatus] = useState<WorkflowExecutionStatus>('running');
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const prevStatusesRef = useRef<Record<string, string>>({});

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

  // Monitor node status transitions to expand running nodes and auto-collapse them on completion
  useEffect(() => {
    setExpandedNodes((prev) => {
      const next = { ...prev };
      const prevStatuses = prevStatusesRef.current;
      for (const run of nodeRuns) {
        const oldStatus = prevStatuses[run.id];
        // If it starts running, auto-expand it
        if (run.status === 'running' && oldStatus !== 'running') {
          next[run.id] = true;
        }
        // If it transitions from running to completed or failed, auto-collapse it
        else if (oldStatus === 'running' && (run.status === 'completed' || run.status === 'failed')) {
          next[run.id] = false;
        }
        // For new historical nodes that are loaded completed/failed, default to collapsed
        else if (oldStatus === undefined && (run.status === 'completed' || run.status === 'failed')) {
          next[run.id] = false;
        }
      }
      // Sync statuses
      const newStatuses: Record<string, string> = {};
      for (const run of nodeRuns) {
        newStatuses[run.id] = run.status;
      }
      prevStatusesRef.current = newStatuses;
      return next;
    });
  }, [nodeRuns]);

  const toggleNodeExpand = (runId: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }));
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
      </div>

      {/* Node Runs List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {!!(taskGoal || execution?.input?.taskGoal) && (
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
              const logs = (nodeLogs[run.node_id] && nodeLogs[run.node_id].length > 0)
                ? nodeLogs[run.node_id]
                : run.logs;
              const isExpanded = !!expandedNodes[run.id];
              const files = detectFilesFromOutput(run.output);

              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-bg-surface)] p-3 transition-all"
                >
                  {/* Card Title & Collapse Toggle */}
                  <div
                    onClick={() => toggleNodeExpand(run.id)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <RunIcon
                        className={`w-3.5 h-3.5 ${config.color} ${run.status === 'running' ? 'animate-spin' : ''} shrink-0`}
                      />
                      <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
                        {run.node_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] shrink-0 ml-2">
                      <span>{formatDuration(run.started_at, run.ended_at)}</span>
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-3 pt-2.5 border-t border-[var(--color-border)]/20 space-y-3">
                      {run.error && (
                        <div className="text-[11px] text-[var(--color-danger)] bg-[var(--color-danger-dim)] rounded px-2 py-1">
                          {run.error}
                        </div>
                      )}

                      {/* Observable Logs Console */}
                      {logs && logs.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold text-[var(--color-text-muted)] mb-1">
                            运行日志
                          </div>
                          <div className="max-h-[140px] overflow-y-auto rounded bg-black/15 p-2 leading-relaxed space-y-1">
                            {logs.map((logLine, idx) => (
                              <RenderLogLine
                                key={idx}
                                line={logLine}
                                isLatest={idx === logs.length - 1}
                                isNodeRunning={run.status === 'running'}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* File Artifacts */}
                      {files.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold text-[var(--color-text-muted)] mb-1">
                            生成文件
                          </div>
                          <div className="space-y-1.5">
                            {files.map((file, idx) => (
                              <FileCard key={idx} filePath={file} projectId={execution?.project_id} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw Outputs JSON */}
                      {run.output && (
                        <details className="group">
                          <summary className="cursor-pointer text-[10px] font-medium text-[var(--color-accent)] select-none">
                            查看原始产物数据
                          </summary>
                          <pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[9px] leading-relaxed text-[var(--color-text-secondary)] font-mono">
                            {extractNodeArtifact(run.output)}
                          </pre>
                        </details>
                      )}
                    </div>
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
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">工作流最终产物</span>
            </div>
            {(() => {
              const files = detectFilesFromOutput(execution.output);
              if (files.length > 0) {
                return (
                  <div className="space-y-1.5 mb-2">
                    {files.map((file, idx) => (
                      <FileCard key={idx} filePath={file} projectId={execution?.project_id} />
                    ))}
                  </div>
                );
              }
              return null;
            })()}
            <details className="group">
              <summary className="cursor-pointer text-[10px] font-medium text-[var(--color-text-secondary)] select-none">
                查看原始数据
              </summary>
              <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                {formatJson(execution.output)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
