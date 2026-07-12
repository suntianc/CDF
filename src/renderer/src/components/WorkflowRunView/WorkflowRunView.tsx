import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  FileText,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  Loader2,
  Trash2,
} from 'lucide-react';

import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { StageNode } from './StageNode';
import { TaskNode } from './TaskNode';
import type { ProjectedStage } from './workflowRunProjection';
import type { WorkflowRunTask, WorkflowStageGate } from '../../../../shared/types';

const nodeTypes = {
  stage: StageNode,
  task: TaskNode,
};

function calculateLayout(stages: ProjectedStage[], tasks: Record<string, WorkflowRunTask>, selectedStageId: string | null) {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // 1. Layout Stages
  stages.forEach((stage, i) => {
      nodes.push({
        id: `stage-${stage.id}`,
        type: 'stage',
        position: { x: i * 240 + 50, y: 30 },
        data: stage as Record<string, unknown>,
        selected: selectedStageId === stage.id,
      });

    if (i > 0) {
      edges.push({
        id: `stage-edge-${stages[i - 1].id}-${stage.id}`,
        source: `stage-${stages[i - 1].id}`,
        target: `stage-${stage.id}`,
        type: 'smoothstep',
        style: { stroke: 'var(--color-border)', strokeWidth: 2 },
      });
    }
  });

  // 2. Layout Tasks for selected stage
  if (selectedStageId) {
    const tasksArray = Object.values(tasks);
    const stageTasks = tasksArray.filter((t) => t.stage_id === selectedStageId);

    // Build dependency map
    const adj: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};

    stageTasks.forEach((t) => {
      adj[t.id] = [];
      inDegree[t.id] = 0;
    });

    stageTasks.forEach((t) => {
      t.dependencies.forEach((depId) => {
        if (adj[depId]) {
          adj[depId].push(t.id);
          inDegree[t.id] = (inDegree[t.id] || 0) + 1;
        }
      });
    });

    // Compute BFS levels (depth) for each task node to layout left-to-right
    const depths: Record<string, number> = {};
    const queue: string[] = [];

    stageTasks.forEach((t) => {
      if ((inDegree[t.id] || 0) === 0) {
        depths[t.id] = 0;
        queue.push(t.id);
      }
    });

    while (queue.length > 0) {
      const u = queue.shift()!;
      const currentDepth = depths[u] || 0;
      for (const v of adj[u] || []) {
        depths[v] = Math.max(depths[v] || 0, currentDepth + 1);
        inDegree[v]--;
        if (inDegree[v] === 0) {
          queue.push(v);
        }
      }
    }

    // In case of cycles or disconnected nodes, assign remaining nodes depth 0
    stageTasks.forEach((t) => {
      if (depths[t.id] === undefined) {
        depths[t.id] = 0;
      }
    });

    // Group by depth to space out vertically
    const depthGroups: Record<number, string[]> = {};
    stageTasks.forEach((t) => {
      const d = depths[t.id];
      if (!depthGroups[d]) {
        depthGroups[d] = [];
      }
      depthGroups[d].push(t.id);
    });

    // Place task nodes
    stageTasks.forEach((t) => {
      const d = depths[t.id];
      const group = depthGroups[d];
      const indexInGroup = group.indexOf(t.id);

      const x = d * 280 + 50;
      const y = indexInGroup * 120 + 200;

      nodes.push({
        id: `task-${t.id}`,
        type: 'task',
        position: { x, y },
        data: { task: t },
      });

      // Add task edges
      t.dependencies.forEach((depId) => {
        if (stageTasks.some((st) => st.id === depId)) {
          edges.push({
            id: `task-edge-${depId}-${t.id}`,
            source: `task-${depId}`,
            target: `task-${t.id}`,
            type: 'smoothstep',
            animated: t.status === 'in_progress',
            style: {
              stroke: t.status === 'completed' ? 'var(--color-success)' : 'var(--color-border)',
              strokeWidth: 1.5,
            },
          });
        }
      });
    });
  }

  return { nodes, edges };
}

export function WorkflowRunView() {
  const { t } = useTranslation();
  const statusLabelKey: Record<string, string> = {
    waiting: 'waiting',
    active: 'active',
    waiting_gate: 'waitingGate',
    passed: 'passed',
    aborted: 'aborted',
    failed: 'failed',
  };
  const {
    activeRun,
    projectionState,
    setSelectedStageId,
    resolveStageGate,
    abortRun,
    isLoading,
    error,
  } = useWorkflowRunStore();

  const [feedback, setFeedback] = useState('');
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectWarning, setRejectWarning] = useState(false);

  const { stages, selectedStageId, tasks, gates } = projectionState;

  const selectedStage = useMemo(() => {
    return stages.find((s) => s.id === selectedStageId) || null;
  }, [stages, selectedStageId]);

  // Find any pending stage gate for the selected stage
  const pendingGate = useMemo(() => {
    if (!selectedStageId) return null;
    return Object.values(gates).find(
      (g) => g.stage_id === selectedStageId && g.status === 'pending'
    ) || null;
  }, [gates, selectedStageId]);

  // Find any resolved stage gate for the selected stage
  const resolvedGate = useMemo(() => {
    if (!selectedStageId) return null;
    return Object.values(gates).find(
      (g) => g.stage_id === selectedStageId && g.status !== 'pending'
    ) || null;
  }, [gates, selectedStageId]);

  // Calculate layout elements
  const { nodes, edges } = useMemo(() => {
    return calculateLayout(stages, tasks, selectedStageId);
  }, [stages, tasks, selectedStageId]);

  const onNodeClick = (_event: React.MouseEvent, node: FlowNode) => {
    if (node.type === 'stage') {
      const stageId = node.id.replace('stage-', '');
      setSelectedStageId(stageId);
      setFeedback('');
      setRejectWarning(false);
      setShowTerminateConfirm(false);
    }
  };

  const handleApprove = async () => {
    if (!pendingGate) return;
    setSubmitting(true);
    try {
      await resolveStageGate(pendingGate.id, 'approve', feedback);
      setFeedback('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!pendingGate) return;
    if (!feedback.trim()) {
      setRejectWarning(true);
      return;
    }
    setRejectWarning(false);
    setSubmitting(true);
    try {
      await resolveStageGate(pendingGate.id, 'reject', feedback);
      setFeedback('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTerminate = async () => {
    if (!activeRun) return;
    setSubmitting(true);
    try {
      if (pendingGate) {
        await resolveStageGate(pendingGate.id, 'terminate', feedback);
      } else {
        await abortRun(activeRun.id);
      }
      setShowTerminateConfirm(false);
      setFeedback('');
    } finally {
      setSubmitting(false);
    }
  };

  // Render Loading, Empty or Error States
  const visibleError = error || projectionState.run?.error;
  if (visibleError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[var(--color-bg-canvas)] border-t border-[var(--color-border)]">
        <AlertTriangle className="w-12 h-12 text-[var(--color-danger)] mb-4" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
          {t('workflow.editor.runFailed')}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] text-center max-w-md">
          {visibleError}
        </p>
      </div>
    );
  }

  if (!activeRun) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[var(--color-bg-canvas)] border-t border-[var(--color-border)]">
        <Loader2 className="w-8 h-8 text-[var(--color-text-muted)] animate-spin mb-4" />
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('workflow.list.loading')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full border-t border-[var(--color-border)] overflow-hidden">
      {/* Left side: React Flow View */}
      <div className="flex-1 h-full relative bg-[var(--color-bg-canvas)] min-w-[300px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background color="var(--color-border)" gap={16} size={1} />
          <Controls showInteractive={false} className="!bg-[var(--color-bg-surface)] !border-[var(--color-border)] !shadow-none" />
          <Panel position="top-left" className="bg-[var(--color-bg-surface)] px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] shadow-sm">
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">
              {projectionState.run?.status === 'waiting_gate' ? t('workflow.runView.waitingGate') : t('workflow.runView.title')}
            </span>
          </Panel>
        </ReactFlow>
      </div>
      {/* Right side: selected Stage details and Stage Gate actions */}
      <div className="w-[360px] h-full shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        {selectedStage ? (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider text-[var(--color-text-muted)] uppercase mb-1">
                <span>{t('workflow.runView.stageDetails')}</span>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-[var(--color-text-secondary)]">{t('workflow.runView.' + (statusLabelKey[selectedStage.status] || selectedStage.status))}</span>
              </div>
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                {selectedStage.name}
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                {selectedStage.taskDescription || t('workflow.runView.noDescription')}
              </p>
            </div>
            {pendingGate && (
              <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-4">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-warning-dim)] border border-[var(--color-warning)]">
                  <Clock className="w-4 h-4 text-[var(--color-warning)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {t('workflow.runView.waitingGate')}
                  </span>
                </div>

                {/* Checklist self-check */}
                {pendingGate.report.acceptanceSelfCheck && pendingGate.report.acceptanceSelfCheck.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-2">
                      {t('workflow.runView.selfCheck')}
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {pendingGate.report.acceptanceSelfCheck.map((check, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)]"
                        >
                          {check.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-[var(--color-danger)] shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[var(--color-text-primary)] leading-tight">
                              {check.criterion}
                            </p>
                            {check.notes && (
                              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                                {check.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generated Artifacts */}
                {pendingGate.report.artifacts && pendingGate.report.artifacts.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-2">
                      {t('workflow.runView.artifacts')}
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {pendingGate.report.artifacts.map((art, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)]"
                        >
                          <FileText className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-[var(--color-text-primary)] break-all leading-tight">
                              {art.path}
                            </p>
                            {art.description && (
                              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                                {art.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {pendingGate.report.summary && (
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-1">
                      {t('workflow.runView.stageReport')}
                    </h3>
                    <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {pendingGate.report.summary}
                    </div>
                  </div>
                )}

                {/* Interactive Feedback & Action Buttons */}
                <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
                  <textarea
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                      if (e.target.value.trim()) setRejectWarning(false);
                    }}
                    placeholder={t('workflow.runView.feedbackPlaceholder')}
                    rows={3}
                    className="w-full text-xs p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
                  />
                  {rejectWarning && (
                    <span className="text-[10px] text-[var(--color-danger)] font-medium">
                    {t('workflow.runView.rejectWarning')}
                    </span>
                  )}

                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleApprove}
                      className="flex-1 py-1.5 px-3 bg-[var(--color-success)] text-[var(--color-text-inverse)] hover:bg-[color-mix(in_srgb,var(--color-success)_85%,black)] rounded-[var(--radius-sm)] text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t('workflow.runView.approve')}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleReject}
                      className="flex-1 py-1.5 px-3 bg-[var(--color-warning)] text-[var(--color-text-inverse)] hover:bg-[color-mix(in_srgb,var(--color-warning)_85%,black)] rounded-[var(--radius-sm)] text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t('workflow.runView.reject')}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setShowTerminateConfirm(true)}
                    className="w-full mt-1 py-1.5 px-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-text-inverse)] rounded-[var(--radius-sm)] text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('workflow.runView.terminate')}
                  </button>
                </div>
              </div>
            )}

            {/* Resolved Gate History View */}
            {resolvedGate && (
              <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-4">
                <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border ${
                  resolvedGate.status === 'approved' || resolvedGate.status === 'auto_approved'
                    ? 'bg-[var(--color-success-dim)] border-[var(--color-success)] text-[var(--color-success)]'
                    : 'bg-[var(--color-danger-dim)] border-[var(--color-danger)] text-[var(--color-danger)]'
                }`}>
                  {resolvedGate.status === 'approved' || resolvedGate.status === 'auto_approved' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {t('workflow.runView.decision')}: {resolvedGate.status === 'approved' || resolvedGate.status === 'auto_approved' ? t('workflow.runView.approved') : t('workflow.runView.rejected')}
                  </span>
                </div>

                {resolvedGate.feedback && (
                  <div>
                    <span className="text-[10px] font-mono tracking-wider text-[var(--color-text-muted)] uppercase block mb-1">
                    {t('workflow.runView.reviewFeedback')}
                    </span>
                    <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-secondary)] italic">
                      "{resolvedGate.feedback}"
                    </div>
                  </div>
                )}

                {resolvedGate.report.summary && (
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-1">
                      {t('workflow.runView.stageReport')}
                    </h3>
                    <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {resolvedGate.report.summary}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* General Stage Info (if no gate has run yet) */}
            {!pendingGate && !resolvedGate && (
              <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
                <div>
                  <h3 className="text-xs font-bold text-[var(--color-text-primary)] mb-1">
                    {t('workflow.editor.addStageHint')}
                  </h3>
                  <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-secondary)]">
                    {t('workflow.runView.waiting')}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <ShieldAlert className="w-8 h-8 text-[var(--color-text-muted)] mb-2" />
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('workflow.runView.noStageSelected')}
            </p>
          </div>
        )}
      </div>

      {/* Terminate confirmation modal */}
      {showTerminateConfirm && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4 z-[var(--z-modal)] animate-fade">
          <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] max-w-sm w-full p-4 shadow-xl">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)] mb-2">
              {t('workflow.runView.terminate')}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              {t('workflow.runView.terminateConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTerminateConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleTerminate}
                className="px-3 py-1.5 text-xs font-bold bg-[var(--color-danger)] text-[var(--color-text-inverse)] hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,black)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
