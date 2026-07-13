import type { WorkflowRun, WorkflowStageGate, WorkflowRunTask, WorkflowRunProjectionEvent, WorkflowRunStatus, WorkflowTaskStatus } from '../../../../shared/types';

export interface ProjectedStage {
  [key: string]: unknown;
  id: string;
  name: string;
  taskDescription: string;
  acceptanceCriteria: string[];
  gateEnabled: boolean;
  status: 'waiting' | 'active' | 'waiting_gate' | 'passed' | 'aborted' | 'failed';
}

export interface WorkflowRunProjectionState {
  run: {
    id: string;
    status: WorkflowRunStatus;
    currentStageIndex: number;
    error: string | null;
  } | null;
  stages: ProjectedStage[];
  selectedStageId: string | null;
  tasks: Record<string, WorkflowRunTask>;
  gates: Record<string, WorkflowStageGate>;
}


export const initialProjectionState: WorkflowRunProjectionState = {
  run: null,
  stages: [],
  selectedStageId: null,
  tasks: {},
  gates: {},
};

export function normalizeAcceptanceCriteria(value: string | string[]): string[] {
  if (Array.isArray(value)) return value.filter((criterion) => criterion.trim().length > 0);
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((criterion): criterion is string => typeof criterion === 'string' && criterion.trim().length > 0);
    }
  } catch {
    // Plain text is the canonical editor format.
  }
  return trimmed
    .split(/\r?\n/)
    .map((criterion) => criterion.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

export function projectWorkflowRun(
  state: WorkflowRunProjectionState,
  event: WorkflowRunProjectionEvent
): WorkflowRunProjectionState {
  switch (event.type) {
    case 'snapshot': {
      const { run, gates, tasks } = event;
      const parsedStages = JSON.parse(run.stages) as Array<{
        id: string;
        name: string;
        taskDescription: string;
        acceptanceCriteria: string | string[];
        gateEnabled: boolean;
      }>;

      // Group gates and tasks by ID for easy lookup
      const nextGates: Record<string, WorkflowStageGate> = {};
      for (const g of gates) {
        nextGates[g.id] = g;
      }
      const nextTasks: Record<string, WorkflowRunTask> = {};
      for (const t of tasks) {
        nextTasks[t.id] = t;
      }

      // Compute stages status
      const stages = parsedStages.map((stage, index) => {
        let status: ProjectedStage['status'] = 'waiting';
        if (run.status === 'aborted' && index === run.current_stage_index) {
          status = 'aborted';
        } else if (run.status === 'failed' && index === run.current_stage_index) {
          status = 'failed';
        } else if (index < run.current_stage_index) {
          status = 'passed';
        } else if (index === run.current_stage_index) {
          // Check if there is a pending gate for this stage
          const hasPendingGate = Object.values(nextGates).some(
            (g) => g.stage_id === stage.id && g.status === 'pending'
          );
          status = hasPendingGate ? 'waiting_gate' : 'active';
        }
        return {
          id: stage.id,
          name: stage.name,
          taskDescription: stage.taskDescription,
          acceptanceCriteria: normalizeAcceptanceCriteria(stage.acceptanceCriteria),
          gateEnabled: !!stage.gateEnabled,
          status,
        };
      });

      const defaultStageId = stages[Math.min(run.current_stage_index, stages.length - 1)]?.id ?? null;
      const selectedStageId = stages.some((stage) => stage.id === state.selectedStageId)
        ? state.selectedStageId
        : defaultStageId;

      return {
        run: {
          id: run.id,
          status: run.status,
          currentStageIndex: run.current_stage_index,
          error: run.error,
        },
        stages,
        selectedStageId,
        tasks: nextTasks,
        gates: nextGates,
      };
    }

    case 'run': {
      if (!state.run) return state;
      if (event.runId && event.runId !== state.run.id) return state;
      const nextRun = {
        ...state.run,
        status: event.status,
        currentStageIndex: event.currentStageIndex,
        error: event.error,
      };

      const nextGates = { ...state.gates };
      const stages = state.stages.map((stage, index) => {
        let status: ProjectedStage['status'] = 'waiting';
        if (event.status === 'aborted' && index === event.currentStageIndex) {
          status = 'aborted';
        } else if (event.status === 'failed' && index === event.currentStageIndex) {
          status = 'failed';
        } else if (index < event.currentStageIndex) {
          status = 'passed';
        } else if (index === event.currentStageIndex) {
          const hasPendingGate = Object.values(nextGates).some(
            (gate) => gate.stage_id === stage.id && gate.status === 'pending',
          );
          status = hasPendingGate ? 'waiting_gate' : 'active';
        }
        return { ...stage, status };
      });

      const selectedStageId = state.selectedStageId || (stages[event.currentStageIndex]?.id ?? null);

      return {
        ...state,
        run: nextRun,
        stages,
        selectedStageId,
      };
    }

    case 'stage_gate': {
      const { gate } = event;
      if (state.run && gate.run_id !== state.run.id) return state;
      const nextGates = { ...state.gates, [gate.id]: gate };

      // Update active stage status if the active stage is waiting on a gate
      const stages = state.stages.map((stage, index) => {
        if (state.run && index === state.run.currentStageIndex) {
          const hasPendingGate = Object.values(nextGates).some(
            (g) => g.stage_id === stage.id && g.status === 'pending'
          );
          return {
            ...stage,
            status: hasPendingGate ? ('waiting_gate' as const) : ('active' as const),
          };
        }
        return stage;
      });

      return {
        ...state,
        gates: nextGates,
        stages,
      };
    }

    case 'task': {
      const { task } = event;
      if (state.run && task.run_id !== state.run.id) return state;
      const nextTasks = { ...state.tasks };

      // 无主派单兜底当前 Stage:
      let finalTask = task;
      if (!task.stage_id && state.run) {
        const currentStageId = state.stages[state.run.currentStageIndex]?.id;
        if (currentStageId) {
          finalTask = {
            ...task,
            stage_id: currentStageId,
          };
        }
      }

      nextTasks[finalTask.id] = finalTask;

      return {
        ...state,
        tasks: nextTasks,
      };
    }

    case 'delegation': {
      const { taskId, batchId, workerId, delegatedRunId, agentSlug } = event;
      const existing = state.tasks[taskId];
      if (!existing) {
        // If task doesn't exist yet, create placeholder fallback task
        let stageId = '';
        if (state.run) {
          stageId = state.stages[state.run.currentStageIndex]?.id ?? '';
        }
        const placeholderTask: WorkflowRunTask = {
          id: taskId,
          run_id: state.run?.id ?? '',
          stage_id: stageId,
          title: agentSlug || 'delegated-task',
          description: '',
          status: 'in_progress',
          dependencies: [],
          delegation_batch_id: batchId,
          delegation_worker_id: workerId,
          delegated_run_id: delegatedRunId ?? workerId,
          delegation_agent_slug: agentSlug,
          created_at: Date.now(),
          updated_at: Date.now(),
          completed_at: null,
        };
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: placeholderTask,
          },
        };
      }

      const updatedTask: WorkflowRunTask = {
        ...existing,
        delegation_batch_id: batchId,
        delegation_worker_id: workerId,
        delegated_run_id: delegatedRunId ?? workerId,
        delegation_agent_slug: agentSlug,
        updated_at: Date.now(),
      };

      return {
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: updatedTask,
        },
      };
    }

    case 'replay': {
      let nextState = initialProjectionState;
      for (const e of event.events) {
        nextState = projectWorkflowRun(nextState, e);
      }
      return nextState;
    }

    default:
      return state;
  }
}
