import type { WorkflowRun, WorkflowStageGate, WorkflowRunTask, WorkflowRunProjectionEvent, WorkflowRunStatus, WorkflowTaskStatus, WorkflowStageRoute } from '../../../../shared/types';

export interface ProjectedStage {
  [key: string]: unknown;
  id: string;
  name: string;
  taskDescription: string;
  acceptanceCriteria: string[];
  gateEnabled: boolean;
  terminal?: boolean;
  routes?: WorkflowStageRoute[];
  status: 'waiting' | 'active' | 'waiting_gate' | 'waiting_input' | 'passed' | 'aborted' | 'failed';
}

export interface WorkflowRunProjectionState {
  run: {
    id: string;
    status: WorkflowRunStatus;
    currentStageId: string;
    currentStageIndex: number;
    error: string | null;
  } | null;
  stages: ProjectedStage[];
  selectedStageId: string | null;
  tasks: Record<string, WorkflowRunTask>;
  gates: Record<string, WorkflowStageGate>;
  selectedRouteIds: string[];
}


export const initialProjectionState: WorkflowRunProjectionState = {
  run: null,
  stages: [],
  selectedStageId: null,
  tasks: {},
  gates: {},
  selectedRouteIds: [],
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

function resolveCurrentStagePosition(
  stages: Array<{ id: string }>,
  currentStageId: string,
): { id: string; index: number } {
  const stableIndex = stages.findIndex((stage) => stage.id === currentStageId);
  return { id: currentStageId, index: stableIndex };
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
        terminal?: boolean;
        routes?: WorkflowStageRoute[];
      }>;

      // Group gates and tasks by ID for easy lookup
      const nextGates: Record<string, WorkflowStageGate> = {};
      for (const g of gates) {
        nextGates[g.id] = g;
      }
      const acceptedGates = gates.filter((gate) => gate.status === 'approved' || gate.status === 'auto_approved');
      const acceptedStageIds = new Set(acceptedGates.map((gate) => gate.stage_id));
      const selectedRouteIds = acceptedGates
        .map((gate) => gate.report.routeSelection?.routeId)
        .filter((routeId): routeId is string => Boolean(routeId));
      const actualStageIds = new Set(acceptedStageIds);
      const currentStage = resolveCurrentStagePosition(parsedStages, run.current_stage_id);
      const currentStageId = currentStage.id;
      if (currentStageId) actualStageIds.add(currentStageId);
      const nextTasks: Record<string, WorkflowRunTask> = {};
      for (const task of tasks) {
        if (actualStageIds.has(task.stage_id)) nextTasks[task.id] = task;
      }

      // Compute stages status
      const stages = parsedStages.map((stage) => {
        let status: ProjectedStage['status'] = 'waiting';
        if (run.status === 'completed' && stage.id === currentStageId) {
          status = 'passed';
        } else if (run.status === 'aborted' && stage.id === currentStageId) {
          status = 'aborted';
        } else if (run.status === 'failed' && stage.id === currentStageId) {
          status = 'failed';
        } else if (stage.id === currentStageId) {
          if (run.status === 'waiting_input') {
            status = 'waiting_input';
          } else {
          // Check if there is a pending gate for this stage
          const hasPendingGate = Object.values(nextGates).some(
            (g) => g.stage_id === stage.id && g.status === 'pending'
          );
          status = hasPendingGate ? 'waiting_gate' : 'active';
          }
        } else if (acceptedStageIds.has(stage.id)) {
          status = 'passed';
        }
        return {
          id: stage.id,
          name: stage.name,
          taskDescription: stage.taskDescription,
          acceptanceCriteria: normalizeAcceptanceCriteria(stage.acceptanceCriteria),
          gateEnabled: !!stage.gateEnabled,
          terminal: stage.terminal === true,
          routes: stage.routes ?? [],
          status,
        };
      });

      const defaultStageId = currentStageId || null;
      const selectedStageId = stages.some((stage) => stage.id === state.selectedStageId)
        ? state.selectedStageId
        : defaultStageId;

      return {
        run: {
          id: run.id,
          status: run.status,
          currentStageId,
          currentStageIndex: currentStage.index,
          error: run.error,
        },
        stages,
        selectedStageId,
        tasks: nextTasks,
        gates: nextGates,
        selectedRouteIds,
      };
    }

    case 'run': {
      if (!state.run) return state;
      if (event.runId && event.runId !== state.run.id) return state;
      const nextRun = {
        ...state.run,
        status: event.status,
        error: event.error,
      };

      const nextGates = { ...state.gates };
      const acceptedStageIds = new Set(Object.values(nextGates)
        .filter((gate) => gate.status === 'approved' || gate.status === 'auto_approved')
        .map((gate) => gate.stage_id));
      const currentStage = resolveCurrentStagePosition(state.stages, event.currentStageId);
      nextRun.currentStageId = currentStage.id;
      nextRun.currentStageIndex = currentStage.index;
      const stages = state.stages.map((stage) => {
        let status: ProjectedStage['status'] = 'waiting';
        if (event.status === 'completed' && stage.id === currentStage.id) {
          status = 'passed';
        } else if (event.status === 'aborted' && stage.id === currentStage.id) {
          status = 'aborted';
        } else if (event.status === 'failed' && stage.id === currentStage.id) {
          status = 'failed';
        } else if (stage.id === currentStage.id) {
          if (event.status === 'waiting_input') {
            status = 'waiting_input';
          } else {
          const hasPendingGate = Object.values(nextGates).some(
            (gate) => gate.stage_id === stage.id && gate.status === 'pending',
          );
          status = hasPendingGate ? 'waiting_gate' : 'active';
          }
        } else if (acceptedStageIds.has(stage.id)) {
          status = 'passed';
        }
        return { ...stage, status };
      });

      const currentStageChanged = state.run.currentStageId !== currentStage.id;
      const selectedStageId = currentStageChanged
        ? currentStage.id || null
        : state.selectedStageId || currentStage.id || null;

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
      const selectedRouteIds = Object.values(nextGates)
        .filter((item) => item.status === 'approved' || item.status === 'auto_approved')
        .map((item) => item.report.routeSelection?.routeId)
        .filter((routeId): routeId is string => Boolean(routeId));

      // Update active stage status if the active stage is waiting on a gate
      const stages = state.stages.map((stage) => {
        if (state.run && stage.id === state.run.currentStageId) {
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
        selectedRouteIds,
      };
    }

    case 'task': {
      const { task } = event;
      if (state.run && task.run_id !== state.run.id) return state;
      const nextTasks = { ...state.tasks };

      // 无主派单兜底当前 Stage:
      let finalTask = task;
      if (!task.stage_id && state.run) {
        const currentStageId = state.run.currentStageId;
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
      const { taskId, batchId, delegatedRunId, agentSlug } = event;
      const existing = state.tasks[taskId];
      if (!existing) {
        // If task doesn't exist yet, create placeholder fallback task
        let stageId = '';
        if (state.run) {
          stageId = state.run.currentStageId;
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
          delegated_run_id: delegatedRunId,
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
        delegated_run_id: delegatedRunId,
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
