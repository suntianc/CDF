import type { Agent, AgentApprovalRequest, AgentRun, AgentToolCall, WorkflowApprovalRequest } from '@shared/types';
import { estimateTokens } from '@/stores/sessionStore';
import type { DelegatedTask, ParallelBatch, ParallelWorker } from '@/stores/sessionStore';
import { projectVideoApprovalSummary } from '../../shared/videoApprovalSummary';

export type ActivityPanelEmptyState = {
  kind: 'noSession' | 'noRun';
  message: string;
};

export type ActivityPanelRunSection = {
  run: AgentRun;
  statusLabel: string;
  startedAt: number;
  error: string | null;
};

export type ActivityPanelToolSummaryFailedCall = {
  id: string;
  toolName: string;
  errorText: string;
};

export type ActivityPanelToolSummarySection = {
  total: number;
  running: number;
  failedCount: number;
  failedCalls: ActivityPanelToolSummaryFailedCall[];
};

export type ActivityPanelApprovalActionSummary = {
  key: string;
  name: string;
  title: string;
  targetLabel: string;
  target: string;
  preview: string;
  previewLabel: string;
};

export type ActivityPanelConversationApprovalSection = {
  approvalId: string;
  title: string;
  actionCountText: string;
  actions: ActivityPanelApprovalActionSummary[];
};

export type ActivityPanelWorkflowApprovalSection = {
  approvalId: string;
  title: string;
  description: string;
  actions: Array<{
    key: string;
    name: string;
    label: string;
  }>;
};

export type ActivityPanelDelegatedTaskItem = {
  task: DelegatedTask;
  agentName: string;
  isActive: boolean;
  statusText: string;
  tokenDisplay: string;
  metricsText: string;
};

export type ActivityPanelDelegatedWorkSection = {
  progress: {
    total: number;
    completedCount: number;
    percentage: number;
  };
  synthesisText: string | null;
  tasks: ActivityPanelDelegatedTaskItem[];
};

export type ActivityPanelParallelWorkerItem = {
  worker: ParallelWorker;
  key: string;
  isActive: boolean;
  displayName: string;
  tokenDisplay: string;
  tokenUnit: string;
  previewText: string | null;
};

export type ActivityPanelParallelWorkSection = {
  title: string;
  batches: Array<{
    batchId: string;
    workers: ActivityPanelParallelWorkerItem[];
  }>;
};

export type ActivityPanelProjection = {
  sessionEmptyState: ActivityPanelEmptyState | null;
  runSection: ActivityPanelRunSection | null;
  toolSummarySection: ActivityPanelToolSummarySection | null;
  conversationApprovalSection: ActivityPanelConversationApprovalSection | null;
  workflowApprovalSection: ActivityPanelWorkflowApprovalSection | null;
  delegatedWorkSection: ActivityPanelDelegatedWorkSection | null;
  parallelWorkSection: ActivityPanelParallelWorkSection | null;
};

export type ProjectActivityPanelInput = {
  activeSessionId: string | null;
  activeRunId: string | null;
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  delegatedTasks: DelegatedTask[];
  parallelBatches: ParallelBatch[];
  pendingApproval: AgentApprovalRequest | null;
  pendingWorkflowApproval: WorkflowApprovalRequest | null;
  agents: Agent[];
  viewingSubagentId: string | null;
  viewingParallelWorker: { batchId: string; agentSlug: string; workerId?: string } | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

function statusLabel(status: AgentRun['status'], t: ProjectActivityPanelInput['t']): string {
  switch (status) {
    case 'running': return t('taskPanel.statusRunning');
    case 'waiting_approval': return t('taskPanel.statusWaitingApproval');
    case 'completed': return t('taskPanel.statusCompleted');
    case 'failed': return t('taskPanel.statusFailed');
    case 'aborted': return t('taskPanel.statusAborted');
  }
}

function failedToolErrorText(toolCall: AgentToolCall, t: ProjectActivityPanelInput['t']): string {
  if (toolCall.tool_name === 'task') return t('taskPanel.subagentCallIntercepted');
  return toolCall.error || t('taskPanel.toolCallFailed');
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


function approvalActionSummary(
  action: AgentApprovalRequest['actions'][number],
  index: number,
  t: ProjectActivityPanelInput['t'],
): ActivityPanelApprovalActionSummary {
  const args = toRecord(action.args);
  if (action.name === 'generate_video') {
    const summary = projectVideoApprovalSummary(args, t);
    return {
      key: `${action.name}-${index}`,
      name: action.name,
      title: t('taskPanel.videoGeneration'),
      targetLabel: t('taskPanel.approvalVideoRouteMode'),
      target: `${summary.route} · ${summary.mode}`,
      preview: [
        summary.inputSummary,
        `${summary.duration}s`,
        summary.resolution,
        summary.nonCancellationWarning,
      ].join(' · '),
      previewLabel: t('taskPanel.approvalInputSummary'),
    };
  }
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
    key: `${action.name}-${index}`,
    name: action.name,
    title: toolLabels[action.name] || action.name,
    targetLabel: t('taskPanel.approvalTarget'),
    target,
    preview: clipText(preview),
    previewLabel,
  };
}

function projectConversationApproval(
  approval: AgentApprovalRequest | null,
  t: ProjectActivityPanelInput['t'],
): ActivityPanelConversationApprovalSection | null {
  if (!approval) return null;
  return {
    approvalId: approval.id,
    title: t('taskPanel.approvalTitle'),
    actionCountText: approval.actions.length > 1
      ? t('taskPanel.approvalActionsMultiple', { count: approval.actions.length })
      : t('taskPanel.approvalActionsSingle'),
    actions: approval.actions.map((action, index) => approvalActionSummary(action, index, t)),
  };
}

function projectWorkflowApproval(
  approval: WorkflowApprovalRequest | null,
  t: ProjectActivityPanelInput['t'],
): ActivityPanelWorkflowApprovalSection | null {
  if (!approval) return null;
  return {
    approvalId: approval.id,
    title: t('workflow.approval.title'),
    description: t('workflow.approval.description'),
    actions: approval.actions.map((action, index) => ({
      key: `${action.name}-${index}`,
      name: action.name,
      label: t('workflow.approval.toolAction', { tool: action.name }),
    })),
  };
}

function tokenDisplayForText(text: string): string {
  const tokenEstimate = estimateTokens(text);
  return tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;
}

function elapsedText(startedAt: number, completedAt: number): string {
  const seconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function delegatedTaskStatusText(task: DelegatedTask, t: ProjectActivityPanelInput['t']): string {
  if (task.status === 'running') return t('taskPanel.statusRunning');
  if (task.status === 'failure') return t('taskPanel.statusFailed');
  return t('taskPanel.statusCompleted');
}

function getAgentName(task: DelegatedTask, agents: Agent[]): string {
  const matched = agents.find((agent) => (agent as { slug?: string }).slug === task.agentSlug || agent.name === task.agentSlug);
  return matched ? matched.name : (task.agentName || task.agentSlug);
}

function projectDelegatedWork(input: ProjectActivityPanelInput, activeRun: AgentRun | null): ActivityPanelDelegatedWorkSection | null {
  const delegatedTasks = input.delegatedTasks ?? [];
  if (delegatedTasks.length === 0) return null;

  const sortedTasks = [...delegatedTasks].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const total = sortedTasks.length;
  const completedCount = sortedTasks.filter((task) => task.status === 'success' || task.status === 'failure').length;
  const percentage = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const allSubagentsComplete = total > 0 && sortedTasks.every((task) => task.status === 'success' || task.status === 'failure');
  const isMasterRunning = activeRun?.status === 'running';

  return {
    progress: {
      total,
      completedCount,
      percentage,
    },
    synthesisText: allSubagentsComplete && isMasterRunning
      ? input.t('taskPanel.synthesizing', { count: total })
      : null,
    tasks: sortedTasks.map((task) => {
      const totalText = task.chunks.length > 0 ? task.chunks.join('') : (task.result?.summary || '');
      const tokenDisplay = tokenDisplayForText(totalText);
      const metricsParts = [`${tokenDisplay} ${input.t('taskPanel.tokenUnit')}`];
      if (task.status !== 'running' && task.startedAt) {
        const end = task.completedAt ?? Date.now();
        metricsParts.push(elapsedText(task.startedAt, end));
      }

      return {
        task,
        agentName: getAgentName(task, input.agents),
        isActive: input.viewingSubagentId === task.taskId,
        statusText: delegatedTaskStatusText(task, input.t),
        tokenDisplay,
        metricsText: metricsParts.join(' · '),
      };
    }),
  };
}

function projectParallelWork(input: ProjectActivityPanelInput): ActivityPanelParallelWorkSection | null {
  const parallelBatches = input.parallelBatches ?? [];
  if (parallelBatches.length === 0) return null;
  return {
    title: '并行任务',
    batches: parallelBatches.map((batch) => ({
      batchId: batch.batchId,
      workers: batch.workers.map((worker) => {
        const key = worker.workerId ?? `${worker.agentSlug}-${worker.startedAt}`;
        const isActive = input.viewingParallelWorker?.batchId === batch.batchId && (
          worker.workerId
            ? input.viewingParallelWorker?.workerId === worker.workerId
            : input.viewingParallelWorker?.agentSlug === worker.agentSlug
        );
        return {
          worker,
          key,
          isActive,
          displayName: worker.agentName ?? worker.agentSlug,
          tokenDisplay: tokenDisplayForText(worker.textBuffer),
          tokenUnit: input.t('taskPanel.tokenUnit'),
          previewText: worker.status !== 'running' ? (worker.summary ?? worker.textBuffer.slice(0, 80)) : null,
        };
      }),
    })),
  };
}

export function projectActivityPanel(input: ProjectActivityPanelInput): ActivityPanelProjection {
  const agentRuns = input.agentRuns ?? [];
  const agentToolCalls = input.agentToolCalls ?? [];
  const activeRun = agentRuns.find((run) => run.id === input.activeRunId) ?? null;
  const toolCalls = activeRun ? agentToolCalls : [];
  const failedCalls = toolCalls.filter((toolCall) => toolCall.status === 'error');

  return {
    sessionEmptyState: !input.activeSessionId
      ? { kind: 'noSession', message: input.t('taskPanel.emptyNoSession') }
      : activeRun
        ? null
        : { kind: 'noRun', message: input.t('taskPanel.emptyNoRun') },
    runSection: activeRun
      ? {
          run: activeRun,
          statusLabel: statusLabel(activeRun.status, input.t),
          startedAt: activeRun.started_at,
          error: activeRun.error ?? null,
        }
      : null,
    toolSummarySection: activeRun && toolCalls.length > 0
      ? {
          total: toolCalls.length,
          running: toolCalls.filter((toolCall) => toolCall.status === 'running').length,
          failedCount: failedCalls.length,
          failedCalls: failedCalls.slice(0, 3).map((toolCall) => ({
            id: toolCall.id,
            toolName: toolCall.tool_name,
            errorText: failedToolErrorText(toolCall, input.t),
          })),
        }
      : null,
    conversationApprovalSection: projectConversationApproval(input.pendingApproval, input.t),
    workflowApprovalSection: projectWorkflowApproval(input.pendingWorkflowApproval, input.t),
    delegatedWorkSection: projectDelegatedWork(input, activeRun),
    parallelWorkSection: projectParallelWork(input),
  };
}
