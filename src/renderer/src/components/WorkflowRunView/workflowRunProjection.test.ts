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
    current_stage_id: 'stage-1',
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

  it('projects waiting_input distinctly and resumes the same Stage on user continuation', () => {
    const waitingRun = { ...dummyRun, status: 'waiting_input' as const };
    let state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot', run: waitingRun, gates: [], tasks: [],
    });
    expect(state.stages[0].status).toBe('waiting_input');

    state = projectWorkflowRun(state, {
      type: 'run', runId: waitingRun.id, status: 'running', currentStageId: 'stage-1', currentStageIndex: 0, error: null,
    });
    expect(state.stages[0].status).toBe('active');
    expect(state.run).toMatchObject({ status: 'running', currentStageIndex: 0 });
  });

  it('replays the accepted branch through convergence and excludes unselected branch tasks', () => {
    const branchStages = [
      { id: 'entry', name: 'Entry', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: false, routes: [
        { id: 'route-left', targetStageId: 'left', condition: 'left' },
        { id: 'route-right', targetStageId: 'right', condition: 'right' },
      ] },
      { id: 'left', name: 'Left', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: false, routes: [{ id: 'left-end', targetStageId: 'end', condition: '' }] },
      { id: 'right', name: 'Right', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: false, routes: [{ id: 'right-end', targetStageId: 'end', condition: '' }] },
      { id: 'end', name: 'End', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    const gate = (id: string, stageId: string, routeId: string, targetStageId: string): WorkflowStageGate => ({
      id, run_id: dummyRun.id, stage_id: stageId, stage_name: stageId,
      report: { acceptanceSelfCheck: [], artifacts: [], summary: '', routeSelection: { routeId, targetStageId, rationale: 'chosen' } },
      status: 'approved', feedback: null, created_at: 1, decided_at: 2,
    });
    const task = (id: string, stageId: string): WorkflowRunTask => ({
      id, run_id: dummyRun.id, stage_id: stageId, title: id, description: '', status: 'completed', dependencies: [],
      delegation_batch_id: null, delegated_run_id: null, delegation_agent_slug: null,
      created_at: 1, updated_at: 1, completed_at: 1,
    });
    const state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: { ...dummyRun, current_stage_id: 'end', current_stage_index: 3, total_stages: 4, stages: JSON.stringify(branchStages) },
      gates: [gate('g1', 'entry', 'route-right', 'right'), gate('g2', 'right', 'right-end', 'end')],
      tasks: [task('left-task', 'left'), task('right-task', 'right'), task('end-task', 'end')],
    });

    expect(state.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ['entry', 'passed'], ['left', 'waiting'], ['right', 'passed'], ['end', 'active'],
    ]);
    expect(state.selectedRouteIds).toEqual(['route-right', 'right-end']);
    expect(Object.keys(state.tasks).sort()).toEqual(['end-task', 'right-task']);
  });

  it('projects the current Stage from stable identity when the compatibility index disagrees', () => {
    const state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: {
        ...dummyRun,
        current_stage_id: 'stage-2',
        current_stage_index: 0,
      },
      gates: [],
      tasks: [],
    });

    expect(state.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ['stage-1', 'waiting'],
      ['stage-2', 'active'],
    ]);
    expect(state.run).toMatchObject({ currentStageId: 'stage-2', currentStageIndex: 1 });
    expect(state.selectedStageId).toBe('stage-2');
  });

  it('moves the inner task graph to the new current Stage after live routing', () => {
    const initial = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot', run: dummyRun, gates: [], tasks: [],
    });

    const advanced = projectWorkflowRun(initial, {
      type: 'run',
      runId: dummyRun.id,
      status: 'running',
      currentStageId: 'stage-2',
      currentStageIndex: 0,
      error: null,
    });

    expect(advanced.run).toMatchObject({ currentStageId: 'stage-2', currentStageIndex: 1 });
    expect(advanced.selectedStageId).toBe('stage-2');
  });

  it('marks the explicit terminal Stage as passed when the run completes', () => {
    const state = projectWorkflowRun(initialProjectionState, {
      type: 'snapshot',
      run: {
        ...dummyRun,
        status: 'completed',
        current_stage_id: 'stage-2',
        current_stage_index: 1,
        stages: JSON.stringify([
          { ...dummyStages[0], terminal: false, routes: [{ id: 'to-end', targetStageId: 'stage-2', condition: '' }] },
          { ...dummyStages[1], terminal: true, routes: [] },
        ]),
      },
      gates: [{
        id: 'terminal-gate',
        run_id: dummyRun.id,
        stage_id: 'stage-2',
        stage_name: 'Stage Two',
        report: { acceptanceSelfCheck: [], artifacts: [], summary: 'Done' },
        status: 'auto_approved',
        feedback: null,
        created_at: 1,
        decided_at: 2,
      }],
      tasks: [],
    });

    expect(state.stages[1].status).toBe('passed');
  });

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
