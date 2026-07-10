import { describe, expect, it } from 'vitest';
import type { Agent, AgentApprovalAction, AgentRun, AgentToolCall } from '@shared/types';
import type { DelegatedTask, ParallelBatch } from '@/stores/sessionStore';
import { projectActivityPanel } from './activityPanelProjection';

const t = (key: string, options?: Record<string, unknown>) => {
  if (!options) return key;
  return `${key}:${JSON.stringify(options)}`;
};

function run(overrides: Partial<AgentRun> & Pick<AgentRun, 'id' | 'status'>): AgentRun {
  return {
    session_id: 'session-1',
    agent_id: 'agent-1',
    request_id: 'request-1',
    started_at: 1_000,
    aborted: 0,
    ...overrides,
  };
}

function toolCall(overrides: Partial<AgentToolCall> & Pick<AgentToolCall, 'id' | 'tool_name' | 'status'>): AgentToolCall {
  return {
    run_id: 'run-1',
    started_at: 2_000,
    ...overrides,
  };
}

function action(overrides: Partial<AgentApprovalAction> & Pick<AgentApprovalAction, 'name'>): AgentApprovalAction {
  return {
    args: {},
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> & Pick<Agent, 'name'>): Agent {
  return {
    id: 'agent-id',
    project_id: 'project-1',
    is_default: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function delegatedTask(overrides: Partial<DelegatedTask> & Pick<DelegatedTask, 'taskId' | 'agentSlug' | 'status'>): DelegatedTask {
  return {
    agentName: overrides.agentSlug,
    goal: 'Review the file',
    chunks: [],
    steps: [],
    ...overrides,
  };
}

describe('projectActivityPanel', () => {
  it('projects an active run with tool summary counts and failed tool display text', () => {
    const activeRun = run({ id: 'run-1', status: 'running', error: 'still retrying' });
    const runningTool = toolCall({ id: 'tool-1', tool_name: 'read_file', status: 'running' });
    const failedTool = toolCall({ id: 'tool-2', tool_name: 'task', status: 'error', error: 'boom' });

    const projection = projectActivityPanel({
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      agentRuns: [activeRun],
      agentToolCalls: [runningTool, failedTool],
      delegatedTasks: [],
      parallelBatches: [],
      pendingApproval: null,
      pendingWorkflowApproval: null,
      agents: [],
      viewingSubagentId: null,
      viewingParallelWorker: null,
      t,
    });

    expect(projection.runSection).toEqual({
      run: activeRun,
      statusLabel: 'taskPanel.statusRunning',
      startedAt: 1_000,
      error: 'still retrying',
    });
    expect(projection.toolSummarySection).toEqual({
      total: 2,
      running: 1,
      failedCount: 1,
      failedCalls: [
        {
          id: 'tool-2',
          toolName: 'task',
          errorText: 'taskPanel.subagentCallIntercepted',
        },
      ],
      });
    });

    it('projects session and run empty states', () => {
      expect(projectActivityPanel({
        activeSessionId: null,
        activeRunId: null,
        agentRuns: [],
        agentToolCalls: [],
        delegatedTasks: [],
        parallelBatches: [],
        pendingApproval: null,
        pendingWorkflowApproval: null,
        agents: [],
        viewingSubagentId: null,
        viewingParallelWorker: null,
        t,
      }).sessionEmptyState).toEqual({
        kind: 'noSession',
        message: 'taskPanel.emptyNoSession',
      });

      expect(projectActivityPanel({
        activeSessionId: 'session-1',
        activeRunId: null,
        agentRuns: [],
        agentToolCalls: [],
        delegatedTasks: [],
        parallelBatches: [],
        pendingApproval: null,
        pendingWorkflowApproval: null,
        agents: [],
        viewingSubagentId: null,
        viewingParallelWorker: null,
        t,
      }).sessionEmptyState).toEqual({
        kind: 'noRun',
        message: 'taskPanel.emptyNoRun',
      });
    });

    it('projects conversation approval action summaries', () => {
      const writeAction = action({
        name: 'write_file',
        args: {
          file_path: '/tmp/example.txt',
          content: 'hello world',
        },
      });

      const projection = projectActivityPanel({
        activeSessionId: 'session-1',
        activeRunId: 'run-1',
        agentRuns: [run({ id: 'run-1', status: 'waiting_approval' })],
        agentToolCalls: [],
        delegatedTasks: [],
        parallelBatches: [],
        pendingApproval: {
          id: 'approval-1',
          runId: 'run-1',
          actions: [writeAction],
        },
        pendingWorkflowApproval: null,
        agents: [],
        viewingSubagentId: null,
        viewingParallelWorker: null,
        t,
      });

      expect(projection.conversationApprovalSection).toEqual({
        approvalId: 'approval-1',
        title: 'taskPanel.approvalTitle',
        actionCountText: 'taskPanel.approvalActionsSingle',
        actions: [
          {
            key: 'write_file-0',
            name: 'write_file',
            title: 'taskPanel.toolWriteFile',
            targetLabel: 'taskPanel.approvalTarget',
            target: '/tmp/example.txt',
            preview: 'hello world',
            previewLabel: 'taskPanel.approvalPreviewWrite',
          },
        ],
      });
    });

    it('projects workflow approval separately from conversation approval', () => {
      const projection = projectActivityPanel({
        activeSessionId: 'session-1',
        activeRunId: null,
        agentRuns: [],
        agentToolCalls: [],
        delegatedTasks: [],
        parallelBatches: [],
        pendingApproval: null,
        pendingWorkflowApproval: {
          id: 'workflow-approval-1',
          executionId: 'execution-1',
          nodeId: 'node-1',
          actions: [
            action({ name: 'write_file' }),
            action({ name: 'delete_file' }),
          ],
        },
        agents: [],
        viewingSubagentId: null,
        viewingParallelWorker: null,
        t,
      });

      expect(projection.workflowApprovalSection).toEqual({
        approvalId: 'workflow-approval-1',
        title: 'workflow.approval.title',
        description: 'workflow.approval.description',
        actions: [
          {
            key: 'write_file-0',
            name: 'write_file',
            label: 'workflow.approval.toolAction:{"tool":"write_file"}',
          },
          {
            key: 'delete_file-1',
            name: 'delete_file',
            label: 'workflow.approval.toolAction:{"tool":"delete_file"}',
          },
        ],
      });
    });

    it('projects delegated work sorting, progress, metrics, and synthesis state', () => {
      const activeRun = run({ id: 'run-1', status: 'running' });
      const olderTask = delegatedTask({
        taskId: 'task-older',
        agentSlug: 'reviewer',
        agentName: 'Reviewer fallback',
        status: 'success',
        chunks: ['abcdabcd'],
        startedAt: 1_000,
        completedAt: 62_000,
      });
      const newerTask = delegatedTask({
        taskId: 'task-newer',
        agentSlug: 'writer',
        agentName: 'Writer fallback',
        status: 'failure',
        result: { status: 'failure', artifacts: [], summary: '失败摘要' },
        startedAt: 2_000,
        completedAt: 3_000,
      });
      const reviewerAgent = { ...agent({ name: 'Reviewer Agent' }), slug: 'reviewer' } as Agent;

      const projection = projectActivityPanel({
        activeSessionId: 'session-1',
        activeRunId: 'run-1',
        agentRuns: [activeRun],
        agentToolCalls: [],
        delegatedTasks: [olderTask, newerTask],
        parallelBatches: [],
        pendingApproval: null,
        pendingWorkflowApproval: null,
        agents: [reviewerAgent],
        viewingSubagentId: 'task-newer',
        viewingParallelWorker: null,
        t,
      });

      expect(projection.delegatedWorkSection).toMatchObject({
        progress: {
          total: 2,
          completedCount: 2,
          percentage: 100,
        },
        synthesisText: 'taskPanel.synthesizing:{"count":2}',
      });
      expect(projection.delegatedWorkSection?.tasks).toEqual([
        {
          task: newerTask,
          agentName: 'Writer fallback',
          isActive: true,
          statusText: 'taskPanel.statusFailed',
          tokenDisplay: '6',
          metricsText: '6 taskPanel.tokenUnit · 1s',
        },
        {
          task: olderTask,
          agentName: 'Reviewer Agent',
          isActive: false,
          statusText: 'taskPanel.statusCompleted',
          tokenDisplay: '2',
          metricsText: '2 taskPanel.tokenUnit · 1m 1s',
        },
      ]);
    });

    it('projects parallel worker summaries and active worker identity', () => {
      const batch: ParallelBatch = {
        batchId: 'batch-1',
        startedAt: 1_000,
        workers: [
          {
            workerId: 'worker-1',
            agentSlug: 'writer',
            agentName: 'Writer',
            status: 'success',
            steps: [],
            textBuffer: 'final worker output',
            summary: 'finished summary',
            startedAt: 1_000,
            completedAt: 2_000,
          },
          {
            agentSlug: 'reviewer',
            status: 'running',
            steps: [],
            textBuffer: 'streaming text',
            startedAt: 3_000,
          },
        ],
      };

      const projection = projectActivityPanel({
        activeSessionId: 'session-1',
        activeRunId: null,
        agentRuns: [],
        agentToolCalls: [],
        delegatedTasks: [],
        parallelBatches: [batch],
        pendingApproval: null,
        pendingWorkflowApproval: null,
        agents: [],
        viewingSubagentId: null,
        viewingParallelWorker: { batchId: 'batch-1', agentSlug: 'writer', workerId: 'worker-1' },
        t,
      });

      expect(projection.parallelWorkSection).toEqual({
        title: '并行任务',
        batches: [
          {
            batchId: 'batch-1',
            workers: [
              {
                worker: batch.workers[0],
                key: 'worker-1',
                isActive: true,
                displayName: 'Writer',
                tokenDisplay: '5',
                tokenUnit: 'taskPanel.tokenUnit',
                previewText: 'finished summary',
              },
              {
                worker: batch.workers[1],
                key: 'reviewer-3000',
                isActive: false,
                displayName: 'reviewer',
                tokenDisplay: '4',
                tokenUnit: 'taskPanel.tokenUnit',
                previewText: null,
              },
            ],
          },
        ],
      });
    });
  });
