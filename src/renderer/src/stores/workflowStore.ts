import { create } from 'zustand';
import { Workflow, WorkflowExecution, WorkflowNodeRun } from '../../../shared/types';

interface WorkflowState {
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  executions: WorkflowExecution[];
  currentExecution: WorkflowExecution | null;
  nodeRuns: WorkflowNodeRun[];
  isLoading: boolean;
  error: string | null;

  fetchWorkflows: (projectId: string) => Promise<void>;
  fetchWorkflow: (id: string) => Promise<void>;
  saveWorkflow: (workflow: any) => Promise<Workflow>;
  deleteWorkflow: (id: string, projectId?: string) => Promise<void>;
  setCurrentWorkflow: (workflow: Workflow | null) => void;

  fetchExecutions: (workflowId: string) => Promise<void>;
  fetchNodeRuns: (executionId: string) => Promise<void>;
  runWorkflow: (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => Promise<string>;
  stopWorkflow: (executionId: string) => Promise<void>;
  subscribeToExecution: (executionId: string) => () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  executions: [],
  currentExecution: null,
  nodeRuns: [],
  isLoading: false,
  error: null,

  fetchWorkflows: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await window.electronAPI.db.getWorkflows(projectId);
      set({ workflows, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch workflows', isLoading: false });
    }
  },

  fetchWorkflow: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const workflow = await window.electronAPI.db.getWorkflow(id);
      set({ currentWorkflow: workflow || null, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch workflow', isLoading: false });
    }
  },

  saveWorkflow: async (workflow: any) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await window.electronAPI.db.saveWorkflow(workflow);
      await get().fetchWorkflows(workflow.project_id);
      set({ isLoading: false });
      return saved;
    } catch (err: any) {
      set({ error: err.message || 'Failed to save workflow', isLoading: false });
      throw err;
    }
  },

  deleteWorkflow: async (id: string, projectId?: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteWorkflow(id);
      const projectToFetch = projectId || get().currentWorkflow?.project_id;
      if (projectToFetch) {
        await get().fetchWorkflows(projectToFetch);
      }
      if (get().currentWorkflow?.id === id) {
        set({ currentWorkflow: null });
      }
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete workflow', isLoading: false });
      throw err;
    }
  },

  setCurrentWorkflow: (workflow: Workflow | null) => {
    set({ currentWorkflow: workflow });
  },

  fetchExecutions: async (workflowId: string) => {
    set({ isLoading: true, error: null });
    try {
      const executions = await window.electronAPI.db.getWorkflowExecutions(workflowId);
      set({ executions, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch executions', isLoading: false });
    }
  },

  fetchNodeRuns: async (executionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const nodeRuns = await window.electronAPI.db.getWorkflowNodeRuns(executionId);
      set({ nodeRuns, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch node runs', isLoading: false });
    }
  },

  runWorkflow: async (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => {
    set({ error: null });
    try {
      const executionId = await window.electronAPI.workflow.runWorkflow(workflowId, projectId, triggerSource, input);
      return executionId;
    } catch (err: any) {
      set({ error: err.message || 'Failed to run workflow' });
      throw err;
    }
  },

  stopWorkflow: async (executionId: string) => {
    set({ error: null });
    try {
      await window.electronAPI.workflow.stopWorkflow(executionId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to stop workflow' });
      throw err;
    }
  },

  subscribeToExecution: (executionId: string) => {
    const unsubscribe = window.electronAPI.workflow.onWorkflowEvent(executionId, (_event: any, data: any) => {
      if (data.type === 'workflow_end') {
        const current = get().currentExecution;
        if (current) {
          set({ currentExecution: { ...current, status: data.status, ended_at: Date.now() } as WorkflowExecution });
        }
      } else if (data.type === 'node_start' || data.type === 'node_end' || data.type === 'node_error') {
        // Refresh node runs when node events arrive
        get().fetchNodeRuns(executionId).catch(() => {});
      }
    });
    return unsubscribe;
  },
}));
