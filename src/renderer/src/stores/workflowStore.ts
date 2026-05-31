import { create } from 'zustand';
import { Workflow, WorkflowExecution, WorkflowNodeRun, WorkflowStreamEvent } from '../../../shared/types';

interface WorkflowState {
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  executions: WorkflowExecution[];
  currentExecution: WorkflowExecution | null;
  nodeRuns: WorkflowNodeRun[];
  nodeLogs: Record<string, string[]>;
  isLoading: boolean;
  error: string | null;

  fetchWorkflows: (projectId: string) => Promise<void>;
  fetchWorkflow: (id: string) => Promise<void>;
  saveWorkflow: (workflow: Omit<Workflow, 'created_at' | 'updated_at'> & { id?: string }) => Promise<Workflow>;
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
  nodeLogs: {},
  isLoading: false,
  error: null,

  fetchWorkflows: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await window.electronAPI.db.getWorkflows(projectId);
      set({ workflows, isLoading: false });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch workflows', isLoading: false });
    }
  },

  fetchWorkflow: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const workflow = await window.electronAPI.db.getWorkflow(id);
      set({ currentWorkflow: workflow || null, isLoading: false });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch workflow', isLoading: false });
    }
  },

  saveWorkflow: async (workflow: Omit<Workflow, 'created_at' | 'updated_at'> & { id?: string }) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await window.electronAPI.db.saveWorkflow(workflow);
      await get().fetchWorkflows(workflow.project_id);
      set({ isLoading: false });
      return saved;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to save workflow', isLoading: false });
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
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete workflow', isLoading: false });
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
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch executions', isLoading: false });
    }
  },

  fetchNodeRuns: async (executionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const dbRuns = await window.electronAPI.db.getWorkflowNodeRuns(executionId);
      // 保留状态中正在运行、且尚未写入数据库的临时节点执行记录
      const currentRunning = get().nodeRuns.filter(
        (r) => r.status === 'running' && !dbRuns.some((d) => d.node_id === r.node_id)
      );
      set({ nodeRuns: [...dbRuns, ...currentRunning], isLoading: false });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch node runs', isLoading: false });
    }
  },

  runWorkflow: async (workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => {
    set({ error: null, nodeLogs: {} });
    try {
      const executionId = await window.electronAPI.workflow.runWorkflow(workflowId, projectId, triggerSource, input);
      set({
        currentExecution: {
          id: executionId,
          workflow_id: workflowId,
          project_id: projectId,
          trigger_source: triggerSource as WorkflowExecution['trigger_source'],
          status: 'running',
          input: input || {},
          started_at: Date.now(),
        },
      });
      return executionId;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to run workflow' });
      throw err;
    }
  },

  stopWorkflow: async (executionId: string) => {
    set({ error: null });
    try {
      await window.electronAPI.workflow.stopWorkflow(executionId);
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Failed to stop workflow' });
      throw err;
    }
  },

  subscribeToExecution: (executionId: string) => {
    const processEvent = (data: WorkflowStreamEvent) => {
      if (data.type === 'workflow_start') {
        const current = get().currentExecution;
        set({
          currentExecution: {
            id: executionId,
            workflow_id: data.workflowId,
            project_id: current?.project_id || '',
            trigger_source: 'editor',
            status: 'running',
            input: current?.input || {},
            started_at: current?.started_at || Date.now(),
          } as WorkflowExecution,
        });
      } else if (data.type === 'workflow_end') {
        const current = get().currentExecution;
        set({
          currentExecution: {
            ...(current ?? {
              id: executionId,
              workflow_id: '',
              project_id: '',
              trigger_source: 'editor',
              input: {},
              started_at: Date.now(),
            }),
            status: data.status,
            ended_at: Date.now(),
          } as WorkflowExecution,
        });
      } else if (data.type === 'node_start') {
        const currentRuns = get().nodeRuns;
        const exists = currentRuns.some((r) => r.node_id === data.nodeId && r.status === 'running');
        if (!exists) {
          const newRun: WorkflowNodeRun = {
            id: `temp-${data.nodeId}-${Date.now()}`,
            execution_id: executionId,
            node_id: data.nodeId,
            node_name: data.nodeName || data.nodeId,
            status: 'running',
            started_at: Date.now(),
            retry_count: 0,
          };
          set({ nodeRuns: [...currentRuns, newRun] });
        }
      } else if (data.type === 'node_end' || data.type === 'node_error') {
        get().fetchNodeRuns(executionId).catch(() => {});
      } else if (data.type === 'node_log') {
        const logs = get().nodeLogs[data.nodeId] || [];
        set({
          nodeLogs: {
            ...get().nodeLogs,
            [data.nodeId]: [...logs, data.log],
          },
        });
      }
    };

    // 1. 获取主进程中可能已积压的历史事件（防止网络/订阅时机竞争导致丢失 start 等关键事件）
    if (window.electronAPI.workflow.getWorkflowEvents) {
      window.electronAPI.workflow.getWorkflowEvents(executionId)
        .then((events) => {
          events.forEach(processEvent);
        })
        .catch((err) => {
          console.warn('[workflowStore] Failed to fetch historical workflow events:', err);
        });
    }

    // 2. 订阅实时事件
    const unsubscribe = window.electronAPI.workflow.onWorkflowEvent(executionId, (_event: unknown, data: WorkflowStreamEvent) => {
      processEvent(data);
    });

    return unsubscribe;
  },
}));
