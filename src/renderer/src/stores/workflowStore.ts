import { create } from 'zustand';
import type { Workflow, WorkflowSaveInput, WorkflowStage } from '../../../shared/types';

interface WorkflowState {
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  isLoading: boolean;
  error: string | null;
  fetchWorkflows: (projectId: string) => Promise<void>;
  fetchWorkflow: (id: string) => Promise<void>;
  saveWorkflow: (workflow: WorkflowSaveInput) => Promise<Workflow>;
  deleteWorkflow: (id: string, projectId?: string) => Promise<void>;
  setCurrentWorkflow: (workflow: Workflow | null) => void;
  addStage: () => void;
  removeStage: (stageId: string) => void;
  updateStage: (stageId: string, data: Partial<Pick<WorkflowStage, 'name' | 'taskDescription' | 'acceptanceCriteria' | 'gateEnabled'>>) => void;
  moveStageUp: (stageId: string) => void;
  moveStageDown: (stageId: string) => void;
  reorderStages: (fromIndex: number, toIndex: number) => void;
}

function normalizeWorkflow(workflow: Workflow): Workflow {
  return { ...workflow, stages: Array.isArray(workflow.stages) ? workflow.stages : [] };
}

function updateCurrentStages(
  set: (updater: (state: WorkflowState) => Partial<WorkflowState>) => void,
  transform: (stages: WorkflowStage[]) => WorkflowStage[],
): void {
  set((state) => {
    if (!state.currentWorkflow) return {};
    return {
      currentWorkflow: {
        ...state.currentWorkflow,
        stages: transform(state.currentWorkflow.stages),
      },
    };
  });
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  isLoading: false,
  error: null,

  fetchWorkflows: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await window.electronAPI.db.getWorkflows(projectId);
      set({ workflows: workflows.map(normalizeWorkflow) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchWorkflow: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const workflow = await window.electronAPI.db.getWorkflow(id);
      set({ currentWorkflow: workflow ? normalizeWorkflow(workflow) : null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  saveWorkflow: async (workflow) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await window.electronAPI.db.saveWorkflow({ ...workflow, stages: workflow.stages ?? [] });
      if (saved) {
        const normalized = normalizeWorkflow(saved);
        set((state) => ({
          workflows: state.workflows.some((item) => item.id === normalized.id)
            ? state.workflows.map((item) => item.id === normalized.id ? normalized : item)
            : [normalized, ...state.workflows],
          currentWorkflow: normalized,
        }));
      }
      return saved;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteWorkflow: async (id, projectId) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteWorkflow(id);
      set((state) => ({
        workflows: state.workflows.filter((workflow) => workflow.id !== id),
        currentWorkflow: state.currentWorkflow?.id === id ? null : state.currentWorkflow,
      }));
      if (projectId) await get().fetchWorkflows(projectId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow ? normalizeWorkflow(workflow) : null }),

  addStage: () => updateCurrentStages(set, (stages) => [...stages, {
    id: crypto.randomUUID(),
    name: '',
    taskDescription: '',
    acceptanceCriteria: '',
    gateEnabled: true,
  }]),

  removeStage: (stageId) => updateCurrentStages(set, (stages) => stages.filter((stage) => stage.id !== stageId)),

  updateStage: (stageId, data) => updateCurrentStages(
    set,
    (stages) => stages.map((stage) => stage.id === stageId ? { ...stage, ...data } : stage),
  ),

  moveStageUp: (stageId) => updateCurrentStages(set, (stages) => {
    const index = stages.findIndex((stage) => stage.id === stageId);
    if (index <= 0) return stages;
    const next = [...stages];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    return next;
  }),

  moveStageDown: (stageId) => updateCurrentStages(set, (stages) => {
    const index = stages.findIndex((stage) => stage.id === stageId);
    if (index < 0 || index >= stages.length - 1) return stages;
    const next = [...stages];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    return next;
  }),

  reorderStages: (fromIndex, toIndex) => updateCurrentStages(set, (stages) => {
    if (fromIndex < 0 || fromIndex >= stages.length || toIndex < 0 || toIndex >= stages.length || fromIndex === toIndex) {
      return stages;
    }
    const next = [...stages];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  }),
}));
