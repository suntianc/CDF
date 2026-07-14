import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelegatedAgentRun, DelegatedTaskResult } from '../../shared/types';
import type {
  DelegatedAgentRunCoordinator,
  RunDelegatedBatchInput,
} from './delegated-agent-run-coordinator';

const {
  dbPrepareMock,
  getRunBySessionIdMock,
  getCurrentStageMock,
  createTaskMock,
  getTaskMock,
  setTaskDelegationMock,
  updateTaskStatusMock,
  pushProjectionEventMock,
  sendMock,
} = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  getRunBySessionIdMock: vi.fn(),
  getCurrentStageMock: vi.fn(),
  createTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  setTaskDelegationMock: vi.fn(),
  updateTaskStatusMock: vi.fn(),
  pushProjectionEventMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{
      isDestroyed: () => false,
      webContents: { send: sendMock },
    }]),
  },
}));

vi.mock('../database', () => ({
  default: { prepare: dbPrepareMock },
}));

vi.mock('../workflow-run/db', () => ({
  getRunBySessionId: getRunBySessionIdMock,
  getCurrentStage: getCurrentStageMock,
  createTask: createTaskMock,
  getTask: getTaskMock,
  setTaskDelegation: setTaskDelegationMock,
  updateTaskStatus: updateTaskStatusMock,
}));

vi.mock('../workflow-run/notify', () => ({
  pushProjectionEvent: pushProjectionEventMock,
}));

import { createParallelTaskTool } from './parallel-task-tool';

const success: DelegatedTaskResult = {
  status: 'success',
  artifacts: ['result.md'],
  summary: 'worker done',
};
const failure: DelegatedTaskResult = {
  status: 'failure',
  artifacts: [],
  summary: '',
  error: { code: 'TOOL_FAILED', message: 'worker failed' },
};

function delegatedRun(id: string, overrides: Partial<DelegatedAgentRun> = {}): DelegatedAgentRun {
  return {
    id,
    parent_run_id: 'run-parent',
    target_agent_id: 'agent-1',
    target_agent_slug: 'worker',
    target_agent_name: 'Worker Agent',
    launch_form: 'parallel',
    task_tool_call_id: null,
    batch_id: 'batch-1',
    workflow_run_task_id: null,
    goal: 'work',
    status: 'completed',
    outcome: success,
    error_code: null,
    error_message: null,
    created_at: 100,
    started_at: 110,
    ended_at: 120,
    updated_at: 120,
    ...overrides,
  };
}

describe('createParallelTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRunBySessionIdMock.mockReturnValue(undefined);
    getCurrentStageMock.mockReturnValue(null);
    getTaskMock.mockReturnValue(undefined);
    createTaskMock.mockReturnValue({ id: 'fallback-task' });
    updateTaskStatusMock.mockImplementation((id: string, status: string) => ({ id, status }));
    dbPrepareMock.mockImplementation((sql: string) => ({
      all: () => sql.includes('FROM agents WHERE project_id')
        ? [{
            id: 'agent-1',
            project_id: 'project-1',
            name: 'Worker Agent',
            slug: 'worker',
            description: 'Does work',
          }]
        : [],
    }));
  });

  it('runs every valid item through the coordinator and aggregates isolated outcomes', async () => {
    const coordinator = {
      runBatch: vi.fn(async (input: RunDelegatedBatchInput) => Promise.all(input.items.map(async (item, index) => {
        const outcome = index === 0 ? failure : success;
        const run = delegatedRun(`delegated-${index + 1}`, {
          goal: item.goal,
          status: outcome.status === 'success' ? 'completed' : 'failed',
          outcome,
        });
        item.onQueued?.({ ...run, status: 'queued', outcome: null });
        item.onStarted?.({ ...run, status: 'running', outcome: null });
        item.onStep?.({ type: 'thinking', ts: 115, content: `step ${index + 1}` });
        item.onFinished?.(run, outcome);
        return { delegatedRun: run, outcome };
      }))),
    } as unknown as DelegatedAgentRunCoordinator;
    const parallelTool = createParallelTaskTool('project-1', 'session-1', {
      coordinator,
      createBatchId: () => 'batch-1',
    });

    const raw = await parallelTool.invoke({
      tasks: [
        { name: 'worker', description: 'first' },
        { name: 'worker', description: 'second' },
      ],
    }, { configurable: { parentAgentRunId: 'run-parent' } });
    const result = JSON.parse(String(raw));

    expect(coordinator.runBatch).toHaveBeenCalledWith(expect.objectContaining({
      parentAgentRunId: 'run-parent',
      batchId: 'batch-1',
      items: [
        expect.objectContaining({ targetAgentId: 'agent-1', goal: 'first' }),
        expect.objectContaining({ targetAgentId: 'agent-1', goal: 'second' }),
      ],
    }));
    expect(result.results).toEqual([
      expect.objectContaining({ delegatedRunId: 'delegated-1', name: 'worker', status: 'failure', error: 'worker failed' }),
      expect.objectContaining({ delegatedRunId: 'delegated-2', name: 'worker', status: 'success', output: 'worker done' }),
    ]);
    const stepEvents = sendMock.mock.calls.map((call) => call[1]);
    expect(stepEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ delegatedRunId: 'delegated-1' }),
      expect.objectContaining({ delegatedRunId: 'delegated-2' }),
    ]));
  });

  it('relates Workflow Run Tasks to Delegated Agent Runs and follows their terminal status', async () => {
    getRunBySessionIdMock.mockReturnValue({ id: 'workflow-run-1' });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'task-1', run_id: 'workflow-run-1', stage_id: 'stage-1' });
    const coordinator = {
      runBatch: vi.fn(async (input: RunDelegatedBatchInput) => {
        const item = input.items[0];
        const run = delegatedRun('delegated-workflow-1', {
          workflow_run_task_id: 'task-1',
          status: 'failed',
          outcome: failure,
        });
        item.onQueued?.({ ...run, status: 'queued', outcome: null });
        item.onStarted?.({ ...run, status: 'running', outcome: null });
        item.onFinished?.(run, failure);
        return [{ delegatedRun: run, outcome: failure }];
      }),
    } as unknown as DelegatedAgentRunCoordinator;
    const parallelTool = createParallelTaskTool('project-1', 'session-1', {
      coordinator,
      createBatchId: () => 'batch-1',
    });

    await parallelTool.invoke({
      tasks: [{ name: 'worker', description: 'linked', runTaskId: 'task-1' }],
    }, { configurable: { parentAgentRunId: 'run-parent' } });

    expect(coordinator.runBatch).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ workflowRunTaskId: 'task-1' })],
    }));
    expect(setTaskDelegationMock).toHaveBeenCalledWith(
      'task-1',
      'batch-1',
      'delegated-workflow-1',
      'worker',
    );
    expect(updateTaskStatusMock).toHaveBeenNthCalledWith(1, 'task-1', 'in_progress');
    expect(updateTaskStatusMock).toHaveBeenNthCalledWith(2, 'task-1', 'failed');
    expect(pushProjectionEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delegation',
      taskId: 'task-1',
      delegatedRunId: 'delegated-workflow-1',
    }));
  });

  it('creates a failed Delegated Agent Run for an unknown target without cancelling valid siblings', async () => {
    const coordinator = {
      runBatch: vi.fn(async (input: RunDelegatedBatchInput) => input.items.map((item, index) => {
        const outcome: DelegatedTaskResult = item.targetAgentId === null
          ? { ...failure, error: { code: 'NOT_FOUND', message: `Agent not found: ${item.targetAgentSlug}` } }
          : success;
        const run = delegatedRun(`delegated-${index + 1}`, {
          target_agent_id: item.targetAgentId,
          target_agent_slug: item.targetAgentSlug,
          target_agent_name: item.targetAgentName,
          goal: item.goal,
          status: outcome.status === 'success' ? 'completed' : 'failed',
          outcome,
        });
        return { delegatedRun: run, outcome };
      })),
    } as unknown as DelegatedAgentRunCoordinator;
    const parallelTool = createParallelTaskTool('project-1', 'session-1', {
      coordinator,
      createBatchId: () => 'batch-1',
    });

    const raw = await parallelTool.invoke({
      tasks: [
        { name: 'missing', description: 'cannot run' },
        { name: 'worker', description: 'can run' },
      ],
    }, { configurable: { parentAgentRunId: 'run-parent' } });
    const result = JSON.parse(String(raw));

    expect(result.results).toEqual([
      expect.objectContaining({ delegatedRunId: 'delegated-1', name: 'missing', status: 'failure', error: 'Agent not found: missing' }),
      expect.objectContaining({ delegatedRunId: 'delegated-2', status: 'success' }),
    ]);
    expect(coordinator.runBatch).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        expect.objectContaining({ targetAgentId: null, targetAgentSlug: 'missing' }),
        expect.objectContaining({ targetAgentId: 'agent-1', targetAgentSlug: 'worker' }),
      ],
    }));
  });
});
