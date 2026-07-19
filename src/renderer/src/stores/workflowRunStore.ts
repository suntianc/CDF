import { create } from 'zustand';
import type { AgentApprovalRequest, ChatRuntimeOverrides, WorkflowRun, WorkflowStageGate, WorkflowRunTask } from '../../../shared/types';
import type { WorkflowRunProjectionEvent } from '../../../shared/types';
import {
  normalizeAcceptanceCriteria,
  projectWorkflowRun,
  initialProjectionState,
  type WorkflowRunProjectionState,
} from '../components/WorkflowRunView/workflowRunProjection';
import {
  buildModelSelectionGroups,
  resolveDefaultModelSelectionCandidate,
} from '../components/ChatArea/modelSelection/useModelSelectionController';
import { useSessionStore } from './sessionStore';
import { useProjectStore } from './projectStore';
import { useAgentStore } from './agentStore';
import { useAISubscriptionStore } from './aiSubscriptionStore';
import { useLLMStore } from './llmStore';

export const WORKFLOW_RUN_MODEL_REQUIRED_ERROR = 'WORKFLOW_RUN_MODEL_REQUIRED';

async function resolveWorkflowRunModelOverrides(): Promise<ChatRuntimeOverrides | null> {
  const pendingLoads: Promise<void>[] = [];
  if (useLLMStore.getState().providers.length === 0) {
    pendingLoads.push(useLLMStore.getState().fetchProviders());
  }
  if (useAgentStore.getState().agents.length === 0) {
    pendingLoads.push(useAgentStore.getState().fetchAgents());
  }
  if (useAISubscriptionStore.getState().entries.length === 0) {
    pendingLoads.push(useAISubscriptionStore.getState().fetchEntries());
  }
  await Promise.all(pendingLoads);

  const providers = useLLMStore.getState().providers;
  const agents = useAgentStore.getState().agents;
  const subscriptionEntries = useAISubscriptionStore.getState().entries;
  const masterAgent = agents.find((agent) => agent.role === 'master') ?? null;
  const masterProvider = providers.find((provider) => provider.id === masterAgent?.provider_id) ?? null;
  const candidates = buildModelSelectionGroups(providers, subscriptionEntries)
    .flatMap((group) => group.candidates);
  const candidate = resolveDefaultModelSelectionCandidate(candidates, masterProvider);
  if (!candidate) return null;

  return {
    modelSource: candidate.sourceType,
    sourceId: candidate.sourceId,
    providerId: candidate.sourceType === 'llm_provider' ? candidate.sourceId : undefined,
    model: candidate.model,
  };
}

function isWorkflowStageApproval(approval: AgentApprovalRequest | null): boolean {
  return approval?.actions.length === 1 && approval.actions[0].name === 'advance_stage';
}

interface WorkflowRunStore {
  activeRun: WorkflowRun | null;
  projectionState: WorkflowRunProjectionState;
  isGraphView: boolean;
  isLoading: boolean;
  error: string | null;
  _requestSeq: number;

  setGraphView: (show: boolean) => void;
  setSelectedStageId: (stageId: string | null) => void;
  startRun: (workflowId: string, projectId: string) => Promise<void>;
  loadRunForSession: (sessionId: string) => Promise<void>;
  dispatchProjectionEvent: (event: WorkflowRunProjectionEvent) => void;
  resolveStageGate: (gateId: string, decision: 'approve' | 'reject' | 'terminate', feedback?: string) => Promise<void>;
  abortRun: (runId: string) => Promise<void>;
  clear: () => void;
}

export const useWorkflowRunStore = create<WorkflowRunStore>((set, get) => ({
  activeRun: null,
  projectionState: initialProjectionState,
  isGraphView: true,
  isLoading: false,
  error: null,
  _requestSeq: 0,

  setGraphView: (show) => set({ isGraphView: show }),
  setSelectedStageId: (stageId) => set((state) => ({
    projectionState: {
      ...state.projectionState,
      selectedStageId: stageId,
    }
  })),

  startRun: async (workflowId, projectId) => {
    set({ isLoading: true, error: null });
    try {
      const modelOverrides = await resolveWorkflowRunModelOverrides();
      if (!modelOverrides?.modelSource || !modelOverrides.sourceId || !modelOverrides.model) {
        throw new Error(WORKFLOW_RUN_MODEL_REQUIRED_ERROR);
      }

      const result = await window.electronAPI.workflowRun.start(workflowId, projectId);

      const sessionStore = useSessionStore.getState();
      sessionStore.setSessionModelOverride(
        result.sessionId,
        modelOverrides.sourceId,
        modelOverrides.model,
        modelOverrides.modelSource,
      );
      await sessionStore.fetchSessions(projectId);
      await sessionStore.selectSession(result.sessionId);

      const projectStore = useProjectStore.getState();
      projectStore.setActiveView('chat');

      const firstStage = result.firstStage;
      const criteria = normalizeAcceptanceCriteria(firstStage.acceptanceCriteria);
      const criteriaList = criteria.length > 0
        ? criteria.map((criterion) => `- ${criterion}`).join('\n')
        : '无';
      const content = `[系统指令] 请开始执行工作流。
当前阶段：${firstStage.name}
任务说明：${firstStage.taskDescription}
验收标准：
${criteriaList}`;

      await sessionStore.sendMessage(projectId, content, modelOverrides, result.sessionId);

      await get().loadRunForSession(result.sessionId);
      set({ isGraphView: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  loadRunForSession: async (sessionId) => {
    const seq = ++get()._requestSeq;
    try {
      const run = await window.electronAPI.workflowRun.getRunBySession(sessionId);
      if (get()._requestSeq !== seq) return;
      if (!run) {
        set({ activeRun: null, projectionState: initialProjectionState });
        const pendingApproval = useSessionStore.getState().pendingApproval;
        if (isWorkflowStageApproval(pendingApproval)) {
          useSessionStore.setState({ pendingApproval: null });
        }
        return;
      }

      const [gates, tasks] = await Promise.all([
        window.electronAPI.workflowRun.getStageGates(run.id),
        window.electronAPI.workflowRun.getTasks(run.id),
      ]);

      if (get()._requestSeq !== seq) return;

      const state = projectWorkflowRun(initialProjectionState, {
        type: 'snapshot',
        run,
        gates,
        tasks,
      });

      if (get()._requestSeq !== seq) return;

      set({ activeRun: run, projectionState: state });
      const pendingGate = gates.find((gate) => gate.status === 'pending');
      const pendingApproval = useSessionStore.getState().pendingApproval;
      if (pendingGate) {
        useSessionStore.setState({
          pendingApproval: {
            id: pendingGate.id,
            runId: run.id,
            actions: [{
              name: 'advance_stage',
              args: { report: pendingGate.report },
              description: `阶段“${pendingGate.stage_name}”完成，等待审批`,
              allowedDecisions: ['approve', 'reject'],
            }],
          },
        });
      } else if (isWorkflowStageApproval(pendingApproval)) {
        useSessionStore.setState({ pendingApproval: null });
      }
    } catch (err: unknown) {
      if (get()._requestSeq === seq) {
        console.error('Failed to load workflow run for session:', err);
      }
    }
  },

  dispatchProjectionEvent: (event) => {
    const state = get();
    if (event.type === 'snapshot') {
      const activeSessionId = useSessionStore.getState().activeSessionId;
      if (activeSessionId && event.run.session_id !== activeSessionId) return;
      set({
        projectionState: projectWorkflowRun(state.projectionState, event),
        activeRun: event.run,
      });
    } else {
      set({
        projectionState: projectWorkflowRun(state.projectionState, event),
      });
    }
  },

  resolveStageGate: async (gateId, decision, feedback) => {
    try {
      await window.electronAPI.workflowRun.resolveStageGate(gateId, { decision, feedback });
      const pendingApproval = useSessionStore.getState().pendingApproval;
      if (isWorkflowStageApproval(pendingApproval) && pendingApproval?.id === gateId) {
        useSessionStore.setState({ pendingApproval: null });
      }
      const activeRun = get().activeRun;
      if (activeRun) {
        await get().loadRunForSession(activeRun.session_id);
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  abortRun: async (runId) => {
    try {
      await window.electronAPI.workflowRun.abort(runId);
      const activeRun = get().activeRun;
      if (activeRun) {
        await get().loadRunForSession(activeRun.session_id);
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  clear: () => set((state) => ({ activeRun: null, projectionState: initialProjectionState, error: null, _requestSeq: state._requestSeq + 1 })),
}));
