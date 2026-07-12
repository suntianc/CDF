import { describe, it, expect } from 'vitest';
import {
  projectWorkflowRun,
  initialProjectionState,
  type WorkflowRunProjectionState,
} from './workflowRunProjection';
import type { WorkflowRun, WorkflowStageGate, WorkflowRunTask } from '../../../../shared/types';

describe('WorkflowRunProjection', () => {
  const dummyStages = [
    {
      id: 'stage-1',
      name: 'Stage One',
      taskDescription: 'First step description',
      acceptanceCriteria: ['Criteria A'],
      gateEnabled: true,
    },
    {
      id: 'stage-2',
      name: 'Stage Two',
      taskDescription: 'Second step description',
      acceptanceCriteria: ['Criteria B'],
      gateEnabled: false,
    },
  ];

  const dummyRun: WorkflowRun = {
    id: 'run-123',
    workflow_id: 'wf-1',
    project_id: 'proj-1',
    session_id: 'sess-1',
    status: 'running',
    current_stage_index: 0,
    total_stages: 2,
    master_agent_id: 'agent-1',
    stages: JSON.stringify(dummyStages),
    skeleton_snapshot: null,
    error: null,
    started_at: Date.now(),
    ended_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  it('should initialize state correctly on snapshot event', () => {
    const state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: dummyRun,
      gates: [],
      tasks: [],
    });

    expect(state.run).toBeDefined();
    expect(state.run?.id).toBe('run-123');
    expect(state.stages).toHaveLength(2);
    expect(state.stages[0].status).toBe('active');
    expect(state.stages[1].status).toBe('waiting');
    expect(state.selectedStageId).toBe('stage-1');
  });

  it('should handle stage gate creation and transition active stage to waiting_gate', () => {
    let state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: dummyRun,
      gates: [],
      tasks: [],
    });

    const gate: WorkflowStageGate = {
      id: 'gate-1',
      run_id: 'run-123',
      stage_id: 'stage-1',
      stage_name: 'Stage One',
      report: { acceptanceSelfCheck: [], artifacts: [], summary: '' },
      status: 'pending',
      feedback: null,
      created_at: Date.now(),
      decided_at: null,
    };

    state = projectWorkflowRun(state, {
      type: 'stage_gate',
      gate,
    });

    expect(state.stages[0].status).toBe('waiting_gate');
    expect(state.gates['gate-1']).toEqual(gate);
  });

  it('should handle unowned task dispatch fallback to current active stage', () => {
    let state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: dummyRun,
      gates: [],
      tasks: [],
    });

    const taskWithoutStage: WorkflowRunTask = {
      id: 'task-1',
      run_id: 'run-123',
      stage_id: '', // missing stage_id
      title: 'Fallback Task',
      description: 'Doing something',
      status: 'in_progress',
      dependencies: [],
      delegation_batch_id: null,
      delegation_worker_id: null,
      delegation_agent_slug: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      completed_at: null,
    };

    state = projectWorkflowRun(state, {
      type: 'task',
      task: taskWithoutStage,
    });

    expect(state.tasks['task-1']).toBeDefined();
    expect(state.tasks['task-1'].stage_id).toBe('stage-1'); // fell back to current active stage
  });

  it('should support event replay and be idempotent', () => {
    const gate: WorkflowStageGate = {
      id: 'gate-1',
      run_id: 'run-123',
      stage_id: 'stage-1',
      stage_name: 'Stage One',
      report: { acceptanceSelfCheck: [], artifacts: [], summary: '' },
      status: 'pending',
      feedback: null,
      created_at: Date.now(),
      decided_at: null,
    };

    const task: WorkflowRunTask = {
      id: 'task-1',
      run_id: 'run-123',
      stage_id: 'stage-1',
      title: 'Task 1',
      description: 'Doing something',
      status: 'completed',
      dependencies: [],
      delegation_batch_id: null,
      delegation_worker_id: null,
      delegation_agent_slug: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      completed_at: null,
    };

    const events = [
      { type: 'snapshot' as const, run: dummyRun, gates: [], tasks: [] },
      { type: 'stage_gate' as const, gate },
      { type: 'task' as const, task },
      { type: 'task' as const, task }, // duplicate
    ];

    const state = projectWorkflowRun(initialProjectionState, {
      type: 'replay',
      events,
    });

    expect(state.run?.id).toBe('run-123');
    expect(state.stages[0].status).toBe('waiting_gate');
    expect(Object.keys(state.tasks)).toHaveLength(1);
    expect(state.tasks['task-1'].status).toBe('completed');
  });
});
