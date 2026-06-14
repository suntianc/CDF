import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '../../stores/workflowStore';
import { ExecutionStep, WorkflowExecution, WorkflowExecutionStatus } from '../../../../shared/types';
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

const statusConfig: Record<string, { icon: typeof Loader2; color: string }> = {
  pending: { icon: Clock, color: 'text-[var(--color-text-muted)]' },
  running: { icon: Loader2, color: 'text-[var(--color-info)]' },
  completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]' },
  failed: { icon: XCircle, color: 'text-[var(--color-danger)]' },
  stopped: { icon: Square, color: 'text-[var(--color-text-muted)]' },
  skipped: { icon: AlertTriangle, color: 'text-[var(--color-warning)]' },
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

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function RenderStep({ step, isLatest, isNodeRunning, t }: { step: ExecutionStep; isLatest: boolean; isNodeRunning: boolean; t: (key: string) => string }) {
  switch (step.type) {
    case 'thinking': {
      const showSpinner = isLatest && isNodeRunning;
      return (
        <div className="flex items-start gap-2 py-1 px-1.5 rounded bg-purple-500/5 text-purple-400 border border-purple-500/10 mb-1">
          {showSpinner && <Loader2 className="w-3 h-3 animate-spin mt-0.5 shrink-0" />}
          <pre className="text-[10px] whitespace-pre-wrap break-words flex-1 m-0 font-mono leading-relaxed">
            {step.content}
          </pre>
        </div>
      );
    }
    case 'tool_call':
      return (
        <div className="flex flex-col gap-1 py-1 px-1.5 rounded bg-[var(--color-info-dim)]/30 border border-[var(--color-info)]/10 mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] px-1 py-0.2 rounded font-bold bg-[var(--color-info)]/20 text-[var(--color-info)]">{t('workflow.execution.stepCall')}</span>
            <span className="text-[9px] font-semibold font-mono">{step.tool}</span>
            <span className="text-[8px] text-[var(--color-text-muted)] ml-auto font-mono">{formatTs(step.ts)}</span>
          </div>
          {step.args !== undefined && (
            <pre className="text-[9px] font-mono whitespace-pre-wrap bg-[var(--color-bg-sunken)] p-1 rounded max-h-[80px] overflow-y-auto">
              {formatJson(step.args)}
            </pre>
          )}
        </div>
      );
    case 'tool_result': {
      const isSuccess = !!step.success;
      const color = isSuccess ? 'success' : 'danger';
      return (
        <div className={`flex flex-col gap-1 py-1 px-1.5 rounded bg-[var(--color-${color}-dim)]/30 border border-[var(--color-${color})]/10 mb-1`}>
          <div className="flex items-center gap-1.5">
            <span className={`text-[8px] px-1 py-0.2 rounded font-bold bg-[var(--color-${color})]/20 text-[var(--color-${color})]`}>
              {isSuccess ? t('workflow.execution.stepResult') : t('workflow.execution.stepFailed')}
            </span>
            <span className="text-[9px] font-semibold font-mono">{step.tool}</span>
            {step.duration_ms !== undefined && (
              <span className="text-[8px] text-[var(--color-text-muted)] ml-auto font-mono">{step.duration_ms}ms</span>
            )}
          </div>
          {isSuccess && step.output !== undefined && (
            <pre className="text-[9px] font-mono whitespace-pre-wrap bg-[var(--color-bg-sunken)] p-1 rounded max-h-[80px] overflow-y-auto">
              {formatJson(step.output)}
            </pre>
          )}
          {!isSuccess && step.error && (
            <pre className="text-[9px] font-mono text-[var(--color-danger)] whitespace-pre-wrap bg-[var(--color-bg-sunken)] p-1 rounded max-h-[80px] overflow-y-auto">
              {step.error}
            </pre>
          )}
        </div>
      );
    }
    case 'task_start':
    case 'task_end':
    case 'system':
    case 'validation':
    default: {
      const label = step.label || step.content || step.type;
      return (
        <div className="text-[9px] py-0.5 text-[var(--color-text-muted)] pl-1 border-l border-[var(--color-border)]/50 font-mono mb-1">
          {label}
        </div>
      );
    }
  }
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

function FileCard({ filePath, projectId, t }: { filePath: string; projectId?: string; t: (key: string) => string }) {
  const isCode = /\.(json|css|html|js|ts|py|go|rs|sh|yml|yaml)$/i.test(filePath);
  const isDoc = /\.(md|txt|pdf|docx|doc)$/i.test(filePath);
  const Icon = isCode ? FileCode : isDoc ? FileText : File;
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const handleOpen = async () => {
    const res = await window.electronAPI.db.openFile(filePath, projectId);
    if (!res.success) {
      alert(res.error || t('workflow.execution.cannotOpenFile'));
    }
  };

  const handleReveal = async () => {
    const res = await window.electronAPI.db.revealFile(filePath, projectId);
    if (!res.success) {
      alert(res.error || t('workflow.execution.cannotRevealFile'));
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
          title={t('workflow.execution.openFile')}
        >
          <ExternalLink className="w-3 h-3" />
          <span>{t('workflow.execution.open')}</span>
        </button>
        <button
          onClick={handleReveal}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer flex items-center gap-0.5"
          title={t('workflow.execution.revealFile')}
        >
          <FolderOpen className="w-3 h-3" />
          <span>{t('workflow.execution.reveal')}</span>
        </button>
      </div>
    </div>
  );
}

export function ExecutionPanel({ executionId, taskGoal, onClose }: ExecutionPanelProps) {
  const { t } = useTranslation();
  const { subscribeToExecution, nodeRuns, fetchNodeRuns, stopWorkflow, currentExecution, nodeTrace } = useWorkflowStore();
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
  const statusLabelMap: Record<string, string> = {
    pending: t('workflow.execution.statusPending'),
    running: t('workflow.execution.statusRunning'),
    completed: t('workflow.execution.statusCompleted'),
    failed: t('workflow.execution.statusFailed'),
    stopped: t('workflow.execution.statusStopped'),
    skipped: t('workflow.execution.statusSkipped'),
  };
  const errorTypeLabelMap: Record<string, string> = {
    timeout: t('workflow.execution.errorTimeout'),
    tool_error: t('workflow.execution.errorToolError'),
    llm_error: t('workflow.execution.errorLlmError'),
    no_routing: t('workflow.execution.errorNoRouting'),
    aborted: t('workflow.execution.errorAborted'),
    unknown: t('workflow.execution.errorUnknown'),
  };
  const statusLabel = statusLabelMap[executionStatus] || executionStatus;

  return (
    <div className="w-[380px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 flex flex-col shrink-0 execution-panel-container">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]/50">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${statusColor} ${isRunning ? 'animate-spin' : ''}`} />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('workflow.execution.title')}</span>
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
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">{t('workflow.execution.taskGoal')}</span>
            </div>
            <div className="text-[11px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">
              {String(taskGoal || execution?.input?.taskGoal)}
            </div>
          </div>
        )}

        {nodeRuns.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)] text-center py-8">
            {isRunning ? t('workflow.execution.waitingNodes') : t('workflow.execution.noRecords')}
          </div>
        ) : (
          <div className="space-y-2">
            {nodeRuns.map((run) => {
              const config = statusConfig[run.status] || statusConfig.pending;
              const runStatusLabel = statusLabelMap[run.status] || run.status;
              const RunIcon = config.icon;
              // 纵深防御:即使 IPC handler 漏 parse,这里也守住数组类型,避免 .map 在字符串上崩溃
              const liveTrace = nodeTrace[run.node_id];
              const fallbackTrace: any = run.execution_trace;
              const steps: ExecutionStep[] =
                Array.isArray(liveTrace) && liveTrace.length > 0
                  ? liveTrace
                  : Array.isArray(fallbackTrace)
                    ? fallbackTrace
                    : [];
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
                      {run.error_type && (
                        <div className="text-[10px] text-[var(--color-text-muted)]">
                          {t('workflow.execution.failureTypePrefix')} {errorTypeLabelMap[run.error_type] || run.error_type}
                        </div>
                      )}

                      {/* Observable Trace Console */}
                      {steps && steps.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold text-[var(--color-text-muted)] mb-1">
                            {t('workflow.execution.executionTrace')}
                          </div>
                          <div className="max-h-[240px] overflow-y-auto rounded bg-[var(--color-bg-sunken)] p-2 leading-relaxed space-y-1">
                            {steps.map((s, idx) => (
                              <RenderStep
                                key={idx}
                                step={s}
                                isLatest={idx === steps.length - 1}
                                isNodeRunning={run.status === 'running'}
                                t={t}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* File Artifacts */}
                      {files.length > 0 && (
                        <div>
                          <div className="text-[9px] font-semibold text-[var(--color-text-muted)] mb-1">
                            {t('workflow.execution.generatedFiles')}
                          </div>
                          <div className="space-y-1.5">
                            {files.map((file, idx) => (
                              <FileCard key={idx} filePath={file} projectId={execution?.project_id} t={t} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw Outputs JSON */}
                      {run.output && (
                        <details className="group">
                          <summary className="cursor-pointer text-[10px] font-medium text-[var(--color-accent)] select-none">
                            {t('workflow.execution.viewRawData')}
                          </summary>
                          <pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-sunken)] p-2 text-[9px] leading-relaxed text-[var(--color-text-secondary)] font-mono">
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
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">{t('workflow.execution.finalArtifact')}</span>
            </div>
            {(() => {
              const files = detectFilesFromOutput(execution.output);
              if (files.length > 0) {
                return (
                  <div className="space-y-1.5 mb-2">
                    {files.map((file, idx) => (
                      <FileCard key={idx} filePath={file} projectId={execution?.project_id} t={t} />
                    ))}
                  </div>
                );
              }
              return null;
            })()}
            <details className="group">
              <summary className="cursor-pointer text-[10px] font-medium text-[var(--color-text-secondary)] select-none">
                {t('workflow.execution.viewRawOutput')}
              </summary>
              <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-sunken)] p-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                {formatJson(execution.output)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
