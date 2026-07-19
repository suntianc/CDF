import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WorkflowRun, WorkflowStageGate, WorkflowRunTask } from '../../../../shared/types';

// Mock @xyflow/react so the view renders each projected node through its registered component.
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, nodeTypes, children }: {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown>; selected?: boolean }>;
    nodeTypes: Record<string, React.ComponentType<{ data: Record<string, unknown>; selected: boolean }>>;
    children?: React.ReactNode;
  }) => (
    <div>
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type];
        return <NodeComponent key={node.id} data={node.data} selected={!!node.selected} />;
      })}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));
vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'workflow.runView.stageLabel': 'STAGE',
    'workflow.runView.taskLabel': 'TASK',
    'workflow.runView.stageDetails': 'STAGE DETAILS',
    'workflow.runView.noDescription': 'No description',
    'workflow.runView.noTitle': 'No title',
    'workflow.runView.rejectWarning': 'Reject requires feedback',
    'workflow.runView.reviewFeedback': 'REVIEW FEEDBACK',
    'workflow.runView.waiting': 'Waiting',
    'workflow.runView.active': 'Active',
    'workflow.runView.waitingGate': 'Awaiting Approval',
    'workflow.runView.passed': 'Passed',
    'workflow.runView.aborted': 'Aborted',
    'workflow.runView.decision': 'Decision',
    'workflow.runView.approved': 'Approved',
    'workflow.runView.rejected': 'Rejected',
    'workflow.runView.approve': 'Approve Stage',
    'workflow.runView.reject': 'Reject & Return',
    'workflow.runView.terminate': 'Terminate Run',
    'workflow.runView.terminateConfirm': 'Are you sure?',
    'workflow.runView.feedbackPlaceholder': 'Feedback...',
    'workflow.runView.selfCheck': 'Self Check',
    'workflow.runView.artifacts': 'Artifacts',
    'workflow.runView.stageReport': 'Stage Report',
    'workflow.runView.noStageSelected': 'Select a stage',
  };
  return {
    useTranslation: () => ({
      t: (key: string) => translations[key] || key,
    }),
  };
});

import {
  projectWorkflowRun,
  initialProjectionState,
  type WorkflowRunProjectionState,
  type ProjectedStage,
} from './workflowRunProjection';

function createMockRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const stages = [
    { id: 'stage-1', name: '需求分析', taskDescription: '分析需求', acceptanceCriteria: '["完成分析"]', gateEnabled: true },
    { id: 'stage-2', name: '设计', taskDescription: '设计架构', acceptanceCriteria: '["完成设计"]', gateEnabled: true },
    { id: 'stage-3', name: '实现', taskDescription: '实现功能', acceptanceCriteria: '["完成实现"]', gateEnabled: false },
  ];
  const currentStageIndex = overrides.current_stage_index ?? 1;
  return {
    id: 'run-1',
    workflow_id: 'wf-1',
    project_id: 'proj-1',
    session_id: 'session-1',
    status: 'waiting_gate',
    current_stage_id: overrides.current_stage_id ?? stages[currentStageIndex]?.id ?? '',
    current_stage_index: currentStageIndex,
    total_stages: 3,
    stages: JSON.stringify(stages),
    skeleton_snapshot: null,
    error: null,
    started_at: Date.now() - 10000,
    ended_at: null,
    created_at: Date.now() - 10000,
    updated_at: Date.now(),
    ...overrides,
    master_agent_id: overrides.master_agent_id ?? 'system-master-agent',
  };
}

function createMockGate(overrides: Partial<WorkflowStageGate> = {}): WorkflowStageGate {
  return {
    id: 'gate-1',
    run_id: 'run-1',
    stage_id: 'stage-2',
    stage_name: '设计',
    report: {
      acceptanceSelfCheck: [
        { criterion: '架构文档完成', passed: true, notes: '' },
        { criterion: 'API 设计评审', passed: false, notes: '需要补充边界情况' },
      ],
      artifacts: [
        { path: 'docs/arch.md', description: '架构文档' },
      ],
      summary: '设计阶段完成，架构已确定',
      tasks: undefined,
    },
    status: 'pending',
    feedback: null,
    created_at: Date.now() - 5000,
    decided_at: null,
    ...overrides,
  };
}

function createMockTask(overrides: Partial<WorkflowRunTask> = {}): WorkflowRunTask {
  return {
    id: 'task-1',
    run_id: 'run-1',
    stage_id: 'stage-2',
    title: '设计数据库',
    description: '设计数据库 Schema',
    status: 'completed',
    dependencies: [],
    delegation_batch_id: null,
    delegation_agent_slug: null,
    created_at: Date.now() - 8000,
    updated_at: Date.now() - 3000,
    completed_at: Date.now() - 3000,
    ...overrides,
  };
}

describe('WorkflowRunProjection – Gate operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stage advance', () => {
    it('marks current stage as waiting_gate when pending gate exists', () => {
      const run = createMockRun({ status: 'running', current_stage_index: 1 });
      const approvedGate = createMockGate({
        id: 'gate-stage-1',
        stage_id: 'stage-1',
        stage_name: '需求分析',
        status: 'approved',
      });
      const gate = createMockGate({ status: 'pending' });
      const task = createMockTask();

      const state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run,
        gates: [approvedGate, gate],
        tasks: [task],
      });

      expect(state.stages[0].status).toBe('passed');
      expect(state.stages[1].status).toBe('waiting_gate');
      expect(state.stages[2].status).toBe('waiting');
    });

    it('marks stage as active when no pending gate exists', () => {
      const run = createMockRun({ status: 'running', current_stage_index: 1, stages: JSON.stringify([
        { id: 'stage-1', name: 'S1', taskDescription: 'T1', acceptanceCriteria: '["a"]', gateEnabled: false },
        { id: 'stage-2', name: 'S2', taskDescription: 'T2', acceptanceCriteria: '["b"]', gateEnabled: false },
      ]) });
      const gate = createMockGate({ status: 'approved', stage_id: 'stage-2' });
      const task = createMockTask();

      const state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run,
        gates: [gate],
        tasks: [task],
      });

      expect(state.stages[1].status).toBe('active');
    });
  });

  describe('reject loop', () => {
    it('returns to active after gate resolution', () => {
      let state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run: createMockRun({ status: 'waiting_gate', current_stage_index: 1 }),
        gates: [createMockGate({ status: 'pending' })],
        tasks: [createMockTask()],
      });

      expect(state.stages[1].status).toBe('waiting_gate');

      // Gate gets rejected
      state = projectWorkflowRun(state, {
        type: 'stage_gate',
        gate: createMockGate({ status: 'rejected', feedback: '需要更多细节' }),
      });

      expect(state.stages[1].status).toBe('active');
      expect(state.run?.status).toBe('waiting_gate');
    });

    it('tracks multiple reject/approve cycles', () => {
      let state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run: createMockRun({ status: 'waiting_gate', current_stage_index: 1 }),
        gates: [createMockGate({ status: 'pending' })],
        tasks: [createMockTask()],
      });

      expect(state.stages[1].status).toBe('waiting_gate');

      // Reject
      state = projectWorkflowRun(state, {
        type: 'stage_gate',
        gate: createMockGate({ status: 'rejected', feedback: '重做', id: 'gate-2' }),
      });
      expect(Object.keys(state.gates).length).toBe(2);

      // Approve
      state = projectWorkflowRun(state, {
        type: 'run',
        status: 'running',
        currentStageId: 'stage-2',
        currentStageIndex: 1,
        error: null,
      });

      const approvedGate = createMockGate({ status: 'approved', id: 'gate-3' });
      state = projectWorkflowRun(state, {
        type: 'stage_gate',
        gate: approvedGate,
      });

      expect(state.stages[1].status).toBe('waiting_gate');
      expect(state.gates['gate-3'].status).toBe('approved');
    });
  });

  describe('planned deps fallback', () => {
    it('assigns stage_id to unowned tasks via current stage', () => {
      const run = createMockRun({ current_stage_index: 2 });
      const unownedTask: WorkflowRunTask = {
        id: 'task-orphan',
        run_id: 'run-1',
        stage_id: '',
        title: '任务',
        description: '',
        status: 'completed',
        dependencies: [],
        delegation_batch_id: null,
        delegation_agent_slug: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        completed_at: Date.now(),
      };

      const state = projectWorkflowRun(
        projectWorkflowRun(initialProjectionState, {
          type: 'snapshot',
          run,
          gates: [],
          tasks: [],
        }),
        { type: 'task', task: unownedTask }
      );

      expect(state.tasks['task-orphan'].stage_id).toBe(state.stages[2].id);
    });

    it('creates placeholder delegation tasks', () => {
      const run = createMockRun({ current_stage_index: 0 });

      const state = projectWorkflowRun(
        projectWorkflowRun(initialProjectionState, {
          type: 'snapshot',
          run,
          gates: [],
          tasks: [],
        }),
        {
          type: 'delegation',
          taskId: 'delegated-1',
          batchId: 'batch-1',
          delegatedRunId: 'worker-1',
          agentSlug: 'code-agent',
        }
      );

      const task = state.tasks['delegated-1'];
      expect(task).toBeDefined();
      expect(task.status).toBe('in_progress');
      expect(task.delegation_agent_slug).toBe('code-agent');
      expect(task.stage_id).toBe('stage-1');
    });
  });

  describe('unowned task fallback', () => {
    it('removes empty stage_id and falls back to current stage', () => {
      const run = createMockRun({ current_stage_index: 2 });
      const unownedTask: WorkflowRunTask = {
        id: 'task-orphan',
        run_id: 'run-1',
        stage_id: '',
        title: '任务',
        description: '',
        status: 'in_progress',
        dependencies: [],
        delegation_batch_id: null,
        delegation_agent_slug: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        completed_at: null,
      };

      let state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run,
        gates: [],
        tasks: [],
      });

      state = projectWorkflowRun(state, { type: 'task', task: unownedTask });
      expect(state.tasks['task-orphan'].stage_id).toBe(state.stages[2].id);
    });
  });

  describe('replay idempotency', () => {
    it('produces the same result when replaying events', () => {
      const events = [
        {
          type: 'snapshot' as const,
          run: createMockRun({ status: 'waiting_gate', current_stage_index: 1 }),
          gates: [createMockGate({ status: 'pending' })],
          tasks: [createMockTask()],
        },
        {
          type: 'stage_gate' as const,
          gate: createMockGate({ status: 'approved', id: 'gate-approved' }),
        },
        {
          type: 'run' as const,
          status: 'running' as const,
          currentStageId: 'stage-3',
          currentStageIndex: 2,
          error: null,
        },
      ];

      // Apply events step by step
      let stepState = initialProjectionState;
      for (const ev of events) {
        stepState = projectWorkflowRun(stepState, ev as never);
      }

      // Apply via replay event
      const replayState = projectWorkflowRun(initialProjectionState, {
        type: 'replay',
        events: events as never[],
      });

      expect(replayState.run?.currentStageIndex).toBe(stepState.run?.currentStageIndex);
      expect(replayState.run?.status).toBe(stepState.run?.status);
      expect(replayState.stages[1].status).toBe(stepState.stages[1].status);
      expect(replayState.stages[2].status).toBe(stepState.stages[2].status);
    });
  });
});

import { StageNode } from './StageNode';
import { TaskNode } from './TaskNode';
import { WorkflowRunView } from './WorkflowRunView';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';

describe('StageNode i18n labels', () => {
  const baseData = {
    id: 'stage-1',
    name: 'Research',
    taskDescription: '',
    acceptanceCriteria: [],
    gateEnabled: true,
    status: 'waiting' as const,
  };

  it('renders stage label via t()', () => {
    render(<StageNode data={baseData} selected={false} />);
    expect(screen.getByText('STAGE')).toBeTruthy();
  });

  it('renders fallback noDescription when taskDescription is empty', () => {
    render(<StageNode data={baseData} selected={false} />);
    expect(screen.getByText('No description')).toBeTruthy();
  });

  it('renders taskDescription when provided instead of fallback', () => {
    const withDesc = { ...baseData, taskDescription: 'Do research' };
    render(<StageNode data={withDesc} selected={false} />);
    expect(screen.getByText('Do research')).toBeTruthy();
    expect(screen.queryByText('No description')).toBeNull();
  });
});

describe('WorkflowRunView task projection', () => {
  it('renders a task from the selected stage', () => {
    const run = createMockRun({ current_stage_index: 1 });
    const task = createMockTask({ title: 'Design database' });
    const projectionState = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run,
      gates: [],
      tasks: [task],
    });
    useWorkflowRunStore.setState({
      activeRun: run,
      projectionState,
      isLoading: false,
      error: null,
    });

    render(<WorkflowRunView />);

    expect(screen.getByText('Design database')).toBeTruthy();
  });
});

describe('TaskNode i18n labels', () => {
  const baseTask = createMockTask({
    title: '',
    description: '',
    status: 'planned',
    completed_at: null,
  });

  it('renders task label via t()', () => {
    render(<TaskNode data={{ task: baseTask }} selected={false} />);
    expect(screen.getByText('TASK')).toBeTruthy();
  });

  it('renders fallback noTitle when title is empty', () => {
    render(<TaskNode data={{ task: baseTask }} selected={false} />);
    expect(screen.getByText('No title')).toBeTruthy();
  });

  it('renders title when provided instead of fallback', () => {
    const withTitle = { ...baseTask, title: 'Gather data' };
    render(<TaskNode data={{ task: withTitle }} selected={false} />);
    expect(screen.getByText('Gather data')).toBeTruthy();
    expect(screen.queryByText('No title')).toBeNull();
  });
});
