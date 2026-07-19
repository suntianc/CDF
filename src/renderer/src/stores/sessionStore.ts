import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import {
  createConversationRuntimeState,
  hydrateConversationRuntimeStream,
  projectConversationRuntime,
  restoreConversationRuntime,
  type ConversationRuntimeProjectionEffect,
  type ConversationRuntimeProjectionState,
} from '../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import {
  createConversationRuntimeRegistryState,
  getConversationRuntimeEntry,
  getConversationRuntimeErrorEntry,
  getConversationRuntimeRequest,
  mergeConversationRuntimeMessages,
  transitionConversationRuntimeRegistry,
  type ConversationRuntimeRegistryAction,
  type ConversationRuntimeRegistryEffect,
  type ConversationRuntimeRegistryState,
} from '../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import {
  AgentApprovalRequest,
  AgentApprovalHistoryEntry,
  AgentRun,
  AgentToolCall,
  ChatRuntimeOverrides,
  ConversationRunStreamEnvelope,
  ConversationRunStreamSnapshot,
  ConversationModelSourceType,
  ExecutionStep,
  LLMStreamEvent,
  Message,
  Session,
  SkillAttribution,
  TodoItem,
} from '../../../shared/types';
import type { ReasoningEffort } from '../../../shared/ai-subscriptions';
import { CONVERSATION_DELETE_ERROR_CODES } from '../../../shared/conversation-deletion';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let englishChars = 0;
  let cjkChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkChars++;
    } else {
      englishChars++;
    }
  }
  return Math.ceil(englishChars / 4) + Math.ceil(cjkChars * 1.5);
}

function parsePersistedToolValue(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function reconcilePersistedToolMessages(messages: Message[], toolCalls: AgentToolCall[]): Message[] {
  if (messages.length === 0 || toolCalls.length === 0) return messages;

  const toolCallsById = new Map(toolCalls.map((call) => [call.id, call]));
  let changed = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== 'system') return message;

    let content: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return message;
      content = parsed as Record<string, unknown>;
    } catch {
      return message;
    }

    if (content.type !== 'tool') return message;
    const call = toolCallsById.get(message.id);
    if (!call || call.status === 'running') return message;

    const nextContent = {
      ...content,
      name: typeof content.name === 'string' ? content.name : call.tool_name,
      status: call.status === 'success' ? 'success' : 'error',
      output: call.status === 'success'
        ? (content.output ?? parsePersistedToolValue(call.output))
        : content.output,
      error: call.status === 'success'
        ? undefined
        : (content.error ?? call.error ?? 'Tool call did not complete successfully'),
    };
    const serialized = JSON.stringify(nextContent);
    if (serialized === message.content) return message;
    changed = true;
    return { ...message, content: serialized };
  });

  return changed ? nextMessages : messages;
}

export interface SessionError {
  message: string;
  messageParams?: Record<string, string | number>;
  recoverableActions?: { label: string; action: () => void }[];
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; code: 'CONVERSATION_BUSY' };

export interface ParallelWorker {
  delegatedRunId: string;
  agentSlug: string;
  agentName?: string;   // 来自 task_start.label
  goal?: string;        // 来自 task_start.goal（原始任务描述）
  summary?: string;     // 来自 task_end.summary（完成后的输出摘要）
  status: 'running' | 'success' | 'failure';
  steps: ExecutionStep[];
  textBuffer: string;
  startedAt: number;
  completedAt?: number;
}

export interface ParallelBatch {
  batchId: string;
  workers: ParallelWorker[];
  startedAt: number;
}

export interface DelegatedTask {
  delegatedRunId: string;
  taskId: string;
  agentSlug: string;
  agentName: string;
  goal: string;
  status: 'running' | 'success' | 'failure';
  chunks: string[];
  steps: ExecutionStep[];
  startedAt?: number;
  completedAt?: number;
  result?: {
    status: 'success' | 'failure';
    artifacts: string[];
    summary: string;
    error?: { code: string; message: string };
  };
  errorCode?: string;
}

// 08.2 P3 C1-05: per-session /goal judge status. Type intentionally lives
// alongside the store contract (rather than in useGoalJudge.ts) so other
// consumers (e.g. GoalSystemBubble) can import the canonical shape without
// pulling in the judge orchestration module.
export type JudgeStatus = 'idle' | 'judging' | 'satisfied' | 'unsatisfied' | 'failed' | 'paused';

export interface GoalJudgeStatusEntry {
  status: JudgeStatus;
  iteration: number;
  startedAt: number;
  reason?: string;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  activeRunId: string | null;
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  delegatedTasks: DelegatedTask[];
  parallelBatches: ParallelBatch[];
  todos: TodoItem[];
  pendingApproval: AgentApprovalRequest | null;
  pendingApprovals: AgentApprovalRequest[];
  approvalHistory: AgentApprovalHistoryEntry[];
  error: SessionError | null;
  isConversationLoading: boolean;
  conversationRuntimeRegistry: ConversationRuntimeRegistryState;
  // D-02/D-04/D-05: per-session user goal (in-memory, persists across switches)
  sessionGoals: Map<string, string>;
  // 08.2 P3 C1-05: per-session /goal judge status (iteration + reason).
  // P6 pitfall (session leak): status is keyed by sessionId and NOT cleared
  // on session switch — goal is sticky per P6 lock. ChatArea/GoalSystemBubble
  // filter by activeSessionId at render time.
  goalJudgeStatus: Map<string, GoalJudgeStatusEntry>;
  sessionModelOverrides: Record<string, {
    providerId: string;
    sourceId?: string;
    sourceType?: ConversationModelSourceType;
    model: string;
    reasoningEffort?: ReasoningEffort;
  }>;
  setSessionModelOverride: (
    sessionId: string,
    sourceId: string,
    model: string,
    sourceType?: ConversationModelSourceType
  ) => void;
  setSessionReasoningEffort: (sessionId: string, effort?: ReasoningEffort) => void;
  fetchSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  fetchAgentActivity: (sessionId: string, force?: boolean) => Promise<void>;
  sendMessage: (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => Promise<SendMessageResult>;
  handleConversationRunEvent: (envelope: ConversationRunStreamEnvelope) => void;
  handleMessagesChanged: (sessionId: string) => void;
  hydrateConversationRun: (sessionId: string, expectedRequestId?: string) => Promise<void>;
  getMessagesForSession: (sessionId: string) => Message[];
  getIsSessionStreaming: (sessionId: string) => boolean;
  setSessionGoal: (sessionId: string, goal: string) => void;
  setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => void;
  getGoalJudgeStatus: (sessionId: string) => GoalJudgeStatusEntry | undefined;
  clearGoalJudgeStatus: (sessionId: string) => void;
  viewingSubagentId: string | null;
  setViewingSubagent: (id: string | null) => void;
  viewingParallelWorker: { batchId: string; delegatedRunId: string; agentSlug: string } | null;
  setViewingParallelWorker: (key: { batchId: string; delegatedRunId: string; agentSlug: string } | null) => void;
  resolveApproval: (decision: 'approve' | 'reject' | 'edit', editedArgs?: string, approvalId?: string) => Promise<void>;
  stopMessage: () => Promise<void>;
  checkContextThreshold: (projectId: string) => Promise<void>;
  clearError: () => void;
  updateMessageThinkDuration: (messageId: string, seconds: number) => void;
}

type StreamingSessionState = ConversationRuntimeProjectionState;
interface ActivityFetchEntry {
  requestId: number;
  promise: Promise<void>;
}

interface SendMessageOptions {
  hiddenUserMessage?: boolean;
  imageBase64?: string[];
  skillAttributions?: SkillAttribution[];
}

export const useSessionStore = create<SessionState>((set, get) => {
  const activityFetches = new Map<string, ActivityFetchEntry>();
  const latestActivityFetchRequestIds = new Map<string, number>();
  let latestSelectSessionRequestId = 0;
  let nextActivityFetchRequestId = 0;

  const projectionDeps = {
    now: () => Date.now(),
    createId: () => window.crypto.randomUUID(),
    estimateTokens,
  };

  const projectionPatch = (projection: ConversationRuntimeProjectionState) => ({
    messages: projection.messages,
    todos: projection.todos,
    delegatedTasks: projection.delegatedTasks,
    parallelBatches: projection.parallelBatches,
    agentRuns: projection.agentRuns,
    agentToolCalls: projection.agentToolCalls,
    activeRunId: projection.activeRunId,
    pendingApproval: projection.pendingApproval,
    pendingApprovals: projection.pendingApprovals,
    approvalHistory: projection.approvalHistory,
    isStreaming: projection.isStreaming,
    streamingMessageId: projection.streamingMessageId,
    isConversationLoading: false,
  });

  const publishRegistryEntry = (conversationId: string) => {
    if (get().activeSessionId !== conversationId) return;
    const registry = get().conversationRuntimeRegistry;
    const entry = getConversationRuntimeEntry(registry, conversationId);
    if (!entry) return;
    const errorEntry = getConversationRuntimeErrorEntry(registry, conversationId);
    const error = errorEntry?.error
      ? {
          message: errorEntry.error.message,
          messageParams: errorEntry.error.messageParams,
          ...(errorEntry.error.retryablePersistence
            ? {
                recoverableActions: [{
                  label: 'chat.retryPersistence',
                  action: () => {
                    transitionRegistry({
                      type: 'retryPersistence',
                      conversationId,
                      requestId: errorEntry.requestId,
                    });
                  },
                }],
              }
            : errorEntry.error.retrySubmission
              ? {
                  recoverableActions: [{
                    label: '重试',
                    action: () => {
                      const retry = errorEntry.error?.retrySubmission;
                      if (!retry) return;
                      void get().sendMessage(
                        retry.projectId,
                        retry.content,
                        retry.overrides,
                        retry.targetSessionId,
                        retry.options,
                      );
                    },
                  }],
                }
              : {}),
        }
      : null;
    set({ ...projectionPatch(entry.projection), error });
  };

  const refreshRegistryHistory = async (conversationId: string, requestId: string) => {
    const getMessages = window.electronAPI?.db?.getMessages;
    if (typeof getMessages !== 'function') return;
    try {
      const persisted = await getMessages(conversationId);
      const entry = getConversationRuntimeRequest(
        get().conversationRuntimeRegistry,
        conversationId,
        requestId,
      );
      if (!entry) return;
      const visibleEntry = getConversationRuntimeEntry(
        get().conversationRuntimeRegistry,
        conversationId,
      );
      if (get().activeSessionId === conversationId && visibleEntry?.requestId === requestId) {
        set({
          messages: mergeConversationRuntimeMessages(persisted, entry.projection),
          isConversationLoading: false,
        });
      }
      transitionRegistry({ type: 'historyRefreshSucceeded', conversationId, requestId });
      if (get().activeSessionId === conversationId) {
        void get().fetchAgentActivity(conversationId, true).catch(() => {});
      }
    } catch (err: unknown) {
      transitionRegistry({
        type: 'historyRefreshFailed',
        conversationId,
        requestId,
        error: { message: err instanceof Error ? err.message : 'Failed to refresh Conversation history' },
      });
      publishRegistryEntry(conversationId);
    }
  };

  const executeRegistryEffects = (effects: ConversationRuntimeRegistryEffect[]) => {
    for (const effect of effects) {
      if (effect.type === 'projectRuntime') {
        publishRegistryEntry(effect.conversationId);
        continue;
      }
      if (effect.type === 'hydrateRuntime') {
        void get().hydrateConversationRun(effect.conversationId, effect.requestId).catch((err) => {
          console.error('Failed to restore active Conversation run:', err);
        });
        continue;
      }
      if (effect.type === 'refreshHistory') {
        void refreshRegistryHistory(effect.conversationId, effect.requestId);
        continue;
      }
      if (effect.type === 'persistTerminal') {
        void window.electronAPI.db.saveMessage(effect.message)
          .then(() => {
            transitionRegistry({
              type: 'persistenceSucceeded',
              conversationId: effect.conversationId,
              requestId: effect.requestId,
            });
          })
          .catch((err: unknown) => {
            const entry = getConversationRuntimeRequest(
              get().conversationRuntimeRegistry,
              effect.conversationId,
              effect.requestId,
            );
            if (!entry) return;
            transitionRegistry({
              type: 'persistenceFailed',
              conversationId: effect.conversationId,
              requestId: effect.requestId,
              projection: entry.projection,
              message: effect.message,
              error: {
                message: err instanceof Error ? err.message : 'chat.persistenceFailed',
              },
            });
          });
        continue;
      }
      if (get().activeSessionId === effect.conversationId) {
        const remainingEntry = getConversationRuntimeEntry(
          get().conversationRuntimeRegistry,
          effect.conversationId,
        );
        if (remainingEntry) {
          publishRegistryEntry(effect.conversationId);
        } else {
          set({ error: null });
        }
      }
    }
  };

  function transitionRegistry(action: ConversationRuntimeRegistryAction) {
    const result = transitionConversationRuntimeRegistry(get().conversationRuntimeRegistry, action);
    if (result.ok && result.applied) {
      set({ conversationRuntimeRegistry: result.state });
      executeRegistryEffects(result.effects);
    }
    return result;
  }

  return ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  activeRunId: null,
  agentRuns: [],
  agentToolCalls: [],
  delegatedTasks: [],
  parallelBatches: [],
  todos: [],
  pendingApproval: null,
  pendingApprovals: [],
  approvalHistory: [],
  error: null,
  isConversationLoading: false,
  conversationRuntimeRegistry: createConversationRuntimeRegistryState(),
  sessionGoals: new Map(),
  goalJudgeStatus: new Map(),
  sessionModelOverrides: (() => {
    try {
      const saved = localStorage.getItem('sessionModelOverrides');
      return saved ? JSON.parse(saved) : {};
    } catch (err) {
      console.error('Failed to load sessionModelOverrides from localStorage:', err);
      return {};
    }
  })(),

  viewingSubagentId: null,
  setViewingSubagent: (id) => set({ viewingSubagentId: id, viewingParallelWorker: null }),
  viewingParallelWorker: null,
  setViewingParallelWorker: (key) => set({ viewingParallelWorker: key, viewingSubagentId: null }),

  setSessionModelOverride: (
    sessionId: string,
    sourceId: string,
    model: string,
    sourceType: ConversationModelSourceType = 'llm_provider'
  ) => {
    set((state) => {
      const reasoningEffort = sourceId && model
        ? state.sessionModelOverrides[sessionId]?.reasoningEffort
        : undefined;
      const nextOverrides = {
        ...state.sessionModelOverrides,
        [sessionId]: {
          providerId: sourceId,
          sourceId,
          sourceType,
          model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      };
      try {
        localStorage.setItem('sessionModelOverrides', JSON.stringify(nextOverrides));
      } catch (err) {
        console.error('Failed to save sessionModelOverrides to localStorage:', err);
      }
      return { sessionModelOverrides: nextOverrides };
    });
  },

  setSessionReasoningEffort: (sessionId: string, effort?: ReasoningEffort) => {
    set((state) => {
      const current = state.sessionModelOverrides[sessionId];
      if (!current) return state;
      const nextOverride = { ...current };
      if (effort) {
        nextOverride.reasoningEffort = effort;
      } else {
        delete nextOverride.reasoningEffort;
      }
      const nextOverrides = {
        ...state.sessionModelOverrides,
        [sessionId]: nextOverride,
      };
      try {
        localStorage.setItem('sessionModelOverrides', JSON.stringify(nextOverrides));
      } catch (err) {
        console.error('Failed to save sessionModelOverrides to localStorage:', err);
      }
      return { sessionModelOverrides: nextOverrides };
    });
  },

  // D-02/D-03: setSessionGoal synchronously writes to a NEW Map (immutability for
  // Zustand shallow-compare re-render). D-04: selectSession does NOT clear this.
  setSessionGoal: (sessionId: string, goal: string) => {
    set((state) => {
      const next = new Map(state.sessionGoals);
      next.set(sessionId, goal);
      return { sessionGoals: next };
    });
  },

  // 08.2 P3 C1-05: shallow-merge judge status partial into existing entry.
  // Empty seed when entry is absent (e.g. first call after startGoalJudgeLoop).
  setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => {
    set((state) => {
      const existing = state.goalJudgeStatus.get(sessionId);
      const next = new Map(state.goalJudgeStatus);
      next.set(sessionId, {
        status: existing?.status ?? 'idle',
        iteration: existing?.iteration ?? 0,
        startedAt: existing?.startedAt ?? Date.now(),
        reason: existing?.reason,
        ...partial,
      });
      return { goalJudgeStatus: next };
    });
  },

  getGoalJudgeStatus: (sessionId: string) => {
    return get().goalJudgeStatus.get(sessionId);
  },

  clearGoalJudgeStatus: (sessionId: string) => {
    set((state) => {
      if (!state.goalJudgeStatus.has(sessionId)) return state;
      const next = new Map(state.goalJudgeStatus);
      next.delete(sessionId);
      return { goalJudgeStatus: next };
    });
  },

  fetchSessions: async (projectId: string) => {
    try {
      const sessions = await window.electronAPI.db.getSessions(projectId);
      set({ sessions });
    } catch (err: any) {
      set({ error: { message: err.message || 'Failed to fetch sessions' } });
    }
  },

  createSession: async (projectId: string, name: string, parentSessionId?: string, summary?: string) => {
    try {
      const newSession = await window.electronAPI.db.createSession(projectId, name, parentSessionId, summary);
      await get().fetchSessions(projectId);
      return newSession;
    } catch (err: any) {
      set({ error: { message: err.message || 'Failed to create session' } });
      throw err;
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await window.electronAPI.db.deleteSession(sessionId);
      set((state) => {
        const remaining = state.sessions.filter((s) => s.id !== sessionId);
        const nextActive = state.activeSessionId === sessionId
          ? (remaining[0]?.id || null)
          : state.activeSessionId;
        // 08.2 P3 P6: clean up goal storage when session is deleted (avoid
        // stale entries that the renderer would never read).
        const nextGoals = new Map(state.sessionGoals);
        nextGoals.delete(sessionId);
        const nextJudge = new Map(state.goalJudgeStatus);
        nextJudge.delete(sessionId);

        const nextOverrides = { ...state.sessionModelOverrides };
        delete nextOverrides[sessionId];
        try {
          localStorage.setItem('sessionModelOverrides', JSON.stringify(nextOverrides));
        } catch (err) {
          console.error('Failed to update sessionModelOverrides in localStorage on delete:', err);
        }

        return {
          sessions: remaining,
          activeSessionId: nextActive,
          sessionGoals: nextGoals,
          goalJudgeStatus: nextJudge,
          sessionModelOverrides: nextOverrides,
        };
      });
      transitionRegistry({ type: 'removeConversation', conversationId: sessionId });

      const { activeSessionId } = get();
      if (activeSessionId) {
        await get().selectSession(activeSessionId);
      } else {
        set({ messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], parallelBatches: [], todos: [], activeRunId: null, pendingApproval: null, pendingApprovals: [], approvalHistory: [] });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        error: {
          message: message.includes(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN)
            ? 'chat.deleteConversationBlockedActiveRun'
            : message.includes(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB)
              ? 'chat.deleteConversationBlockedCapabilityJob'
              : message || 'Failed to delete session',
        },
      });
    }
  },
 
  selectSession: async (sessionId: string | null) => {
    const requestId = ++latestSelectSessionRequestId;
    if (!sessionId) {
      set({ activeSessionId: null, messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], parallelBatches: [], todos: [], activeRunId: null, pendingApproval: null, pendingApprovals: [], approvalHistory: [], error: null, isStreaming: false, streamingMessageId: null, isConversationLoading: false, viewingSubagentId: null, viewingParallelWorker: null });
      return;
    }

    const selectedEntry = getConversationRuntimeEntry(get().conversationRuntimeRegistry, sessionId);
    set({
      activeSessionId: sessionId,
      viewingSubagentId: null,
      viewingParallelWorker: null,
      ...(selectedEntry
        ? { ...projectionPatch(selectedEntry.projection), error: null }
        : {
            messages: [],
            agentRuns: [],
            agentToolCalls: [],
            delegatedTasks: [],
            parallelBatches: [],
            todos: [],
            activeRunId: null,
            pendingApproval: null,
            pendingApprovals: [],
            approvalHistory: [],
            error: null,
            isStreaming: false,
            streamingMessageId: null,
            isConversationLoading: true,
          }),
    });
    if (selectedEntry) publishRegistryEntry(sessionId);
    const messagesAtLoadStart = get().messages;

    try {
      let messages: Message[] | null = null;
      let messageError: unknown = null;
      try {
        messages = await window.electronAPI.db.getMessages(sessionId);
      } catch (err: unknown) {
        messageError = err;
      }

      if (latestSelectSessionRequestId !== requestId || get().activeSessionId !== sessionId) return;

      if (messages) {
        const entryDuringLoad = getConversationRuntimeEntry(get().conversationRuntimeRegistry, sessionId);
        if (entryDuringLoad) {
          const baseProjection = {
            ...entryDuringLoad.baseProjection,
            messages,
          };
          transitionRegistry({
            type: 'mergeHistory',
            conversationId: sessionId,
            requestId: entryDuringLoad.requestId,
            baseProjection,
            projection: {
              ...entryDuringLoad.projection,
              messages: mergeConversationRuntimeMessages(messages, entryDuringLoad.projection),
            },
          });
        } else {
          const liveMessages = get().messages;
          if (liveMessages !== messagesAtLoadStart) {
            const liveById = new Map(liveMessages.map((message) => [message.id, message]));
            const persistedIds = new Set(messages.map((message) => message.id));
            set({
              messages: [
                ...messages.map((message) => liveById.get(message.id) ?? message),
                ...liveMessages.filter((message) => !persistedIds.has(message.id)),
              ],
              isConversationLoading: false,
              error: null,
            });
          } else {
            set({ messages, isConversationLoading: false, error: null });
          }
        }
      } else {
        set({
          isConversationLoading: false,
          error: {
            message: messageError instanceof Error
              ? messageError.message
              : 'Failed to load messages for session',
          },
        });
      }

      if (get().activeSessionId === sessionId && latestSelectSessionRequestId === requestId) {
        try {
          await get().fetchAgentActivity(sessionId, true);
        } catch {
          // fetchAgentActivity records the source Conversation error.
        }
      }
      if (get().activeSessionId === sessionId && latestSelectSessionRequestId === requestId) {
        const entry = get().conversationRuntimeRegistry.entries[sessionId];
        if (!entry || (entry.active && entry.streamSource === 'envelope')) {
          transitionRegistry({
            type: 'requestHydration',
            conversationId: sessionId,
            ...(entry ? { requestId: entry.requestId } : {}),
          });
        }
      }
    } catch (err: unknown) {
      if (latestSelectSessionRequestId === requestId && get().activeSessionId === sessionId) {
        set({
          isConversationLoading: false,
          error: { message: err instanceof Error ? err.message : 'Failed to load messages for session' },
        });
      }
    }
  },

  fetchAgentActivity: async (sessionId: string, force = false) => {
    if (!force) {
      const existingFetch = activityFetches.get(sessionId);
      if (existingFetch) return existingFetch.promise;
    }

    const requestId = ++nextActivityFetchRequestId;
    latestActivityFetchRequestIds.set(sessionId, requestId);

    const entry: ActivityFetchEntry = {
      requestId,
      promise: Promise.resolve().then(async () => {
        try {
        if (
          typeof window.electronAPI.db.getAgentRuns !== 'function' ||
          typeof window.electronAPI.db.getAgentToolCalls !== 'function'
        ) {
          if (get().activeSessionId === sessionId && latestActivityFetchRequestIds.get(sessionId) === requestId) {
            set({ agentRuns: [], agentToolCalls: [], delegatedTasks: [], parallelBatches: [], activeRunId: null });
          }
          return;
        }
        const runs = await window.electronAPI.db.getAgentRuns(sessionId);
        const delegatedAgentRuns = typeof window.electronAPI.db.getDelegatedAgentRuns === 'function'
          ? await window.electronAPI.db.getDelegatedAgentRuns(sessionId)
          : [];
        const delegatedToolActions = typeof window.electronAPI.db.getDelegatedToolActions === 'function'
          ? await window.electronAPI.db.getDelegatedToolActions(sessionId)
          : [];
        const activeRun = runs[0] || null;
        const toolCalls = activeRun ? await window.electronAPI.db.getAgentToolCalls(activeRun.id) : [];
        const historicalToolCalls = runs.length > 1
          ? (await Promise.all(runs.slice(1).map((run) => window.electronAPI.db.getAgentToolCalls(run.id)))).flat()
          : [];
        const messageToolCalls = [...toolCalls, ...historicalToolCalls];

        // Detect stale running state against the Registry's authoritative ownership.
        const registryEntry = get().conversationRuntimeRegistry.entries[sessionId];
        const isSessionStreaming = registryEntry?.active ?? false;

      // Reconstruct the latest successful todos from database history on session switch
      let latestTodos: TodoItem[] = [];
      try {
        if (typeof window.electronAPI.db.getLatestTodos === 'function') {
          const lastTodosToolCall = await window.electronAPI.db.getLatestTodos(sessionId);
          if (lastTodosToolCall && lastTodosToolCall.output) {
            const outputObj = typeof lastTodosToolCall.output === 'string'
              ? JSON.parse(lastTodosToolCall.output)
              : lastTodosToolCall.output;
            let todosList = null;
            if (Array.isArray(outputObj)) {
              todosList = outputObj;
            } else if (outputObj.update && Array.isArray(outputObj.update.todos)) {
              todosList = outputObj.update.todos;
            } else {
              const val = outputObj || {};
              if (val.update && Array.isArray(val.update.todos)) {
                todosList = val.update.todos;
              }
            }
            if (Array.isArray(todosList)) {
              latestTodos = todosList;
            }
          }
        }
      } catch (err) {
        console.warn('[sessionStore] Failed to fetch/parse latest todos from DB:', err);
      }

        const restoredRuntime = restoreConversationRuntime({
          sessionId,
          isStreaming: isSessionStreaming,
          agentRuns: runs,
          agentToolCalls: toolCalls,
          delegatedAgentRuns,
          delegatedToolActions,
          latestTodos,
        });
        const tasks = restoredRuntime.delegatedTasks;

        if (get().activeSessionId !== sessionId || latestActivityFetchRequestIds.get(sessionId) !== requestId) return;

        // Preserve live chunks from streaming cache and current store state.
        // DB-reconstructed tasks always have chunks: [] (streaming chunks are
        // transient and not persisted to SQLite). Merging from both sources
        // prevents "0 块 / 0 tokens" flash on every reopen / session switch.
        const streamProjection = getConversationRuntimeEntry(
          get().conversationRuntimeRegistry,
          sessionId,
        )?.projection;
        const storeTasks = get().delegatedTasks ?? [];

        for (const t of tasks) {
          // Prefer streaming cache chunks (most recent), fall back to current
          // store chunks (may survive a brief cache deletion window), then keep
          // the DB-derived empty array as last resort.
          const streamCached = streamProjection?.delegatedTasks?.find(
            (candidate) => candidate.delegatedRunId === t.delegatedRunId,
          );
          const storeTask = storeTasks.find(
            (candidate) => candidate.delegatedRunId === t.delegatedRunId,
          );

          if (streamCached && streamCached.chunks.length > 0) {
            t.chunks = streamCached.chunks;
            // Streaming cache may carry a human-readable agentName; DB
            // reconstruction uses the slug as fallback.
            if (streamCached.agentName && streamCached.agentName !== streamCached.agentSlug) {
              t.agentName = streamCached.agentName;
            }
          } else if (storeTask && storeTask.chunks.length > 0) {
            t.chunks = storeTask.chunks;
          }

          // Preserve runtime-injected steps (not persisted to DB).
          if (streamCached && streamCached.steps.length > 0) {
            t.steps = streamCached.steps;
          } else if (storeTask && storeTask.steps.length > 0) {
            t.steps = storeTask.steps;
          }

          // Also preserve startedAt from streaming cache / store if the DB
          // tool call didn't record one (e.g. task tool call created before
          // run_started event was received).
          if (!t.startedAt) {
            t.startedAt = streamCached?.startedAt ?? storeTask?.startedAt;
          }
        }

        const messages = reconcilePersistedToolMessages(get().messages, messageToolCalls);

        const currentEntry = getConversationRuntimeEntry(get().conversationRuntimeRegistry, sessionId);
        if (currentEntry) {
          const restoredApprovalIds = new Set(restoredRuntime.approvalHistory.map((entry) => entry.approval.id));
          const approvalHistory = [
            ...restoredRuntime.approvalHistory,
            ...currentEntry.projection.approvalHistory.filter((entry) => !restoredApprovalIds.has(entry.approval.id)),
          ];
          const baseProjection = {
            ...currentEntry.baseProjection,
            messages,
            agentRuns: restoredRuntime.agentRuns,
            agentToolCalls: restoredRuntime.agentToolCalls,
            delegatedTasks: tasks,
            parallelBatches: restoredRuntime.parallelBatches,
            todos: restoredRuntime.todos,
            activeRunId: restoredRuntime.activeRunId,
            approvalHistory,
          };
          transitionRegistry({
            type: 'mergeHistory',
            conversationId: sessionId,
            requestId: currentEntry.requestId,
            baseProjection,
            projection: {
              ...currentEntry.projection,
              messages: mergeConversationRuntimeMessages(messages, currentEntry.projection),
              approvalHistory,
            },
          });
        } else {
          set({
            messages,
            agentRuns: restoredRuntime.agentRuns,
            agentToolCalls: restoredRuntime.agentToolCalls,
            delegatedTasks: tasks,
            parallelBatches: restoredRuntime.parallelBatches,
            todos: restoredRuntime.todos,
            activeRunId: restoredRuntime.activeRunId,
            approvalHistory: restoredRuntime.approvalHistory,
          });
        }
      } catch (err: any) {
        if (get().activeSessionId === sessionId && latestActivityFetchRequestIds.get(sessionId) === requestId) {
          set({ error: { message: err.message || 'Failed to load agent activity' } });
        }
        throw err;
        } finally {
          if (activityFetches.get(sessionId) === entry) {
            activityFetches.delete(sessionId);
          }
          if (latestActivityFetchRequestIds.get(sessionId) === requestId) {
            latestActivityFetchRequestIds.delete(sessionId);
          }
        }
      }),
    };

    activityFetches.set(sessionId, entry);
    return entry.promise;
  },

  getMessagesForSession: (sessionId: string) => {
    if (get().activeSessionId === sessionId) return get().messages;
    return getConversationRuntimeEntry(get().conversationRuntimeRegistry, sessionId)?.projection.messages ?? [];
  },

  getIsSessionStreaming: (sessionId: string) => {
    return get().conversationRuntimeRegistry.entries[sessionId]?.active ?? false;
  },

  handleConversationRunEvent: (envelope) => {
    const current = get();
    const existing = current.conversationRuntimeRegistry.entries[envelope.sessionId];
    const visibleEntry = getConversationRuntimeEntry(
      current.conversationRuntimeRegistry,
      envelope.sessionId,
    );
    const visibleProjection = visibleEntry?.projection;
    const isSelected = current.activeSessionId === envelope.sessionId;
    const initialProjection = existing?.baseProjection ?? createConversationRuntimeState({
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      streamingMessageId: envelope.messageId,
      currentAssistantMsgId: envelope.messageId,
      ...((isSelected || visibleProjection)
        ? {
            messages: visibleProjection?.messages ?? current.messages,
            todos: visibleProjection?.todos ?? current.todos,
            delegatedTasks: visibleProjection?.delegatedTasks ?? current.delegatedTasks,
            parallelBatches: visibleProjection?.parallelBatches ?? current.parallelBatches,
            agentRuns: visibleProjection?.agentRuns ?? current.agentRuns,
            agentToolCalls: visibleProjection?.agentToolCalls ?? current.agentToolCalls,
            activeRunId: visibleProjection?.activeRunId ?? current.activeRunId,
            pendingApproval: visibleProjection?.pendingApproval ?? current.pendingApproval,
            pendingApprovals: visibleProjection?.pendingApprovals ?? current.pendingApprovals,
            approvalHistory: visibleProjection?.approvalHistory ?? current.approvalHistory,
          }
        : {}),
    });
    const sourceProjection = existing?.requestId === envelope.requestId
      ? existing.projection
      : initialProjection;
    const projected = projectConversationRuntime(
      sourceProjection,
      { kind: 'llm', event: envelope.event },
      projectionDeps,
    );
    const retryableError = projected.effects.find((effect) => effect.type === 'setRetryableError');

    transitionRegistry({
      type: 'receiveEnvelope',
      envelope,
      initialProjection,
      projection: projected.state,
      ...(retryableError
        ? {
            error: {
              message: retryableError.message,
              messageParams: retryableError.messageParams,
            },
          }
        : {}),
    });
  },

  handleMessagesChanged: (sessionId) => {
    const entry = get().conversationRuntimeRegistry.entries[sessionId];
    // Active foreground state is already current in the Registry; background
    // completion emits its own request-scoped refreshHistory effect.
    if (entry?.active) return;
    if (get().activeSessionId === sessionId) {
      void get().selectSession(sessionId);
    }
  },

  hydrateConversationRun: async (sessionId, expectedRequestId) => {
    if (typeof window.electronAPI.conversation?.getActiveRun !== 'function') return;
    const snapshot = await window.electronAPI.conversation.getActiveRun(sessionId);
    const existing = get().conversationRuntimeRegistry.entries[sessionId];
    if (!snapshot) {
      // A request-less hydration may race with a newly claimed foreground Run.
      // Only the identity that requested hydration may release ownership.
      if (expectedRequestId) {
        transitionRegistry({
          type: 'hydrateMissing',
          conversationId: sessionId,
          requestId: expectedRequestId,
        });
      }
      return;
    }

    const normalizedSnapshot: ConversationRunStreamSnapshot = {
      ...snapshot,
      events: snapshot.events ?? [],
    };
    const current = get();
    const baseProjection = existing?.requestId === snapshot.requestId
      ? existing.baseProjection
      : createConversationRuntimeState({
          sessionId,
          requestId: snapshot.requestId,
          streamingMessageId: snapshot.messageId,
          currentAssistantMsgId: snapshot.messageId,
          ...(current.activeSessionId === sessionId
            ? {
                messages: current.messages,
                todos: current.todos,
                delegatedTasks: current.delegatedTasks,
                parallelBatches: current.parallelBatches,
                agentRuns: current.agentRuns,
                agentToolCalls: current.agentToolCalls,
                activeRunId: current.activeRunId,
                pendingApproval: current.pendingApproval,
                pendingApprovals: current.pendingApprovals,
                approvalHistory: current.approvalHistory,
                isStreaming: current.isStreaming,
              }
            : {}),
        });
    const projection = hydrateConversationRuntimeStream(
      baseProjection,
      normalizedSnapshot,
      projectionDeps,
    );
    transitionRegistry({
      type: 'hydrateSnapshot',
      conversationId: sessionId,
      requestId: snapshot.requestId,
      sequence: snapshot.sequence,
      projection,
      baseProjection,
    });
  },


  sendMessage: async (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => {
    const { activeSessionId, sessions } = get();
    const sessionId = targetSessionId ?? activeSessionId;
    if (!sessionId) return { ok: true };
    const activeSession = sessions.find((session) => session.id === sessionId);

    const userMsgId = window.crypto.randomUUID();
    const assistantMsgId = window.crypto.randomUUID();
    const userTokens = estimateTokens(content);
    const userMsg: Message = {
      id: userMsgId,
      session_id: sessionId,
      role: 'user',
      content,
      tokens: userTokens,
      created_at: Date.now(),
      ...(options?.imageBase64?.length ? { imageBase64: options.imageBase64 } : {}),
    };
    const skillAttributionMessages: Message[] = options?.skillAttributions?.length
      ? [{
        id: window.crypto.randomUUID(),
        session_id: sessionId,
        role: 'system',
        content: JSON.stringify({
          type: 'skill_attribution',
          attributions: options.skillAttributions,
        }),
        tokens: 0,
        created_at: Date.now(),
      }]
      : [];
    const assistantMsgPlaceholder: Message = {
      id: assistantMsgId,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      tokens: 0,
      created_at: Date.now(),
    };
    const initialState: StreamingSessionState = createConversationRuntimeState({
      sessionId,
      requestId: assistantMsgId,
      streamingMessageId: assistantMsgId,
      currentAssistantMsgId: assistantMsgId,
      messages: [
        ...get().getMessagesForSession(sessionId),
        ...(options?.hiddenUserMessage ? [] : [userMsg]),
        ...skillAttributionMessages,
        assistantMsgPlaceholder,
      ],
      todos: [],
      delegatedTasks: [],
      parallelBatches: [],
      agentRuns: [],
      agentToolCalls: [],
      activeRunId: null,
      pendingApproval: null,
      pendingApprovals: [],
      approvalHistory: [],
      isStreaming: true,
      accumulatedContent: '',
      pendingToolMessages: {},
      runtimeToolMessageIds: [],
    });

    const claim = transitionRegistry({
      type: 'claim',
      conversationId: sessionId,
      requestId: assistantMsgId,
      projection: initialState,
    });
    if (!claim.ok) return { ok: false, code: claim.code };
    publishRegistryEntry(sessionId);

    // Clear old todos only when this request owns the visible Conversation.
    if (get().activeSessionId === sessionId) {
      set({ todos: [] });
    }

    try {
      if (!options?.hiddenUserMessage) {
        await window.electronAPI.db.saveMessage(userMsg);
      }
      for (const message of skillAttributionMessages) {
        await window.electronAPI.db.saveMessage(message);
      }

      transitionRegistry({
        type: 'update',
        conversationId: sessionId,
        requestId: assistantMsgId,
        projection: initialState,
      });

      let cleanup = () => {};
      let parallelCleanup = () => {};

      const executeRuntimeProjectionEffect = async (
        effect: ConversationRuntimeProjectionEffect,
        nextState: StreamingSessionState,
        resolve: () => void,
        reject: (reason?: unknown) => void,
      ): Promise<boolean> => {
        if (effect.type === 'openActivityPanel') {
          const projectStore = useProjectStore.getState();
          if (projectStore.activeView === 'chat' && get().activeSessionId === sessionId) {
            projectStore.setTaskPanelOpen(true);
          }
          return false;
        }

        if (effect.type === 'saveMessage') {
          const terminalAssistantSave = !nextState.isStreaming
            && effect.message.id === nextState.currentAssistantMsgId;
          try {
            await window.electronAPI.db.saveMessage(effect.message);
            if (terminalAssistantSave) {
              transitionRegistry({
                type: 'persistenceSucceeded',
                conversationId: sessionId,
                requestId: assistantMsgId,
              });
            }
          } catch (err: unknown) {
            console.error('Failed to save runtime projection message:', err);
            if (terminalAssistantSave) {
              transitionRegistry({
                type: 'persistenceFailed',
                conversationId: sessionId,
                requestId: assistantMsgId,
                projection: nextState,
                message: effect.message,
                error: {
                  message: err instanceof Error ? err.message : 'chat.persistenceFailed',
                },
              });
            } else if (get().activeSessionId === sessionId) {
              set({ error: { message: err instanceof Error ? err.message : 'chat.persistenceFailed' } });
            }
          }
          return false;
        }

        if (effect.type === 'cleanupStream') {
          cleanup();
          parallelCleanup();
          return false;
        }

        if (effect.type === 'setRetryableError') {
          transitionRegistry({
            type: 'terminalFailed',
            conversationId: sessionId,
            requestId: assistantMsgId,
            projection: nextState,
            error: {
              message: effect.message || '对话请求出错',
              messageParams: effect.messageParams,
              retrySubmission: {
                projectId,
                content,
                overrides,
                targetSessionId,
                options,
              },
            },
          });
          if (get().activeSessionId === sessionId) {
            set({
              error: {
                message: effect.message || '对话请求出错',
                messageParams: effect.messageParams,
                recoverableActions: [{ label: '重试', action: () => get().sendMessage(projectId, content, overrides, targetSessionId, options) }],
              },
            });
          }
          return false;
        }

        if (effect.type === 'resolveStream') {
          transitionRegistry({
            type: 'release',
            conversationId: sessionId,
            requestId: assistantMsgId,
          });
          resolve();
          return true;
        }

        if (effect.type === 'rejectStream') {
          transitionRegistry({
            type: 'release',
            conversationId: sessionId,
            requestId: assistantMsgId,
          });
          reject(new Error(effect.error || '对话请求出错'));
          return true;
        }

        return false;
      };

      parallelCleanup = window.electronAPI.deepagents.onParallelTaskStep(sessionId, (_event: unknown, data: { batchId: string; delegatedRunId: string; agentSlug: string; step: ExecutionStep }) => {
        const runtime = get().conversationRuntimeRegistry.entries[sessionId];
        if (!runtime || runtime.requestId !== assistantMsgId) return;
        const result = projectConversationRuntime(runtime.projection, { kind: 'parallelTaskStep', event: data }, projectionDeps);
        transitionRegistry({
          type: 'update',
          conversationId: sessionId,
          requestId: assistantMsgId,
          projection: result.state,
        });
      });

      const streamPromise = new Promise<void>((resolve, reject) => {
        let streamEventQueue = Promise.resolve();

        const processStreamEvent = async (data: LLMStreamEvent) => {
          const runtime = get().conversationRuntimeRegistry.entries[sessionId];
          if (!runtime || runtime.requestId !== assistantMsgId) return;
          const result = projectConversationRuntime(runtime.projection, { kind: 'llm', event: data }, projectionDeps);
          const update = transitionRegistry({
            type: 'update',
            conversationId: sessionId,
            requestId: assistantMsgId,
            projection: result.state,
          });
          if (!update.ok || !update.applied) return;

          let terminal = false;
          for (const effect of result.effects) {
            terminal = await executeRuntimeProjectionEffect(effect, result.state, resolve, reject) || terminal;
          }

        };

        cleanup = window.electronAPI.llm.onChunk(assistantMsgId, (_event: unknown, data: LLMStreamEvent) => {
          streamEventQueue = streamEventQueue.then(
            () => processStreamEvent(data),
            () => processStreamEvent(data),
          );
          return streamEventQueue;
        });
      });

      const sessionModelOverride = get().sessionModelOverrides[sessionId] || {};
      const sessionOverrideSourceType = sessionModelOverride.sourceType || 'llm_provider';
      const finalOverrides = {
        modelSource: sessionModelOverride.sourceId ? sessionOverrideSourceType : undefined,
        sourceId: sessionModelOverride.sourceId || undefined,
        providerId: sessionOverrideSourceType === 'llm_provider'
          ? sessionModelOverride.providerId || undefined
          : undefined,
        model: sessionModelOverride.model || undefined,
        ...(sessionModelOverride.reasoningEffort
          ? { reasoningEffort: sessionModelOverride.reasoningEffort }
          : {}),
        ...overrides,
      };

      try {
        await window.electronAPI.llm.chat(assistantMsgId, {
          projectId,
          sessionId,
          message: {
            id: userMsgId,
            content,
            ...(options?.imageBase64?.length ? { imageBase64: options.imageBase64 } : {}),
          },
          overrides: finalOverrides,
        });
        await streamPromise;
      } catch (err: any) {
        cleanup();
        parallelCleanup();
        // 移除未持久化的 assistant 占位和工具消息
        const runtime = getConversationRuntimeRequest(
          get().conversationRuntimeRegistry,
          sessionId,
          assistantMsgId,
        );
        const projection = runtime?.projection;
        const transientMessageIds = new Set([
          assistantMsgId,
          projection?.currentAssistantMsgId,
          ...Object.values(projection?.pendingToolMessages ?? {}).flat(),
          ...(projection?.runtimeToolMessageIds ?? []),
        ].filter(Boolean));
        const release = transitionRegistry({
          type: 'release',
          conversationId: sessionId,
          requestId: assistantMsgId,
        });
        if (release.ok && release.applied && get().activeSessionId === sessionId) {
          set((state) => ({
            messages: state.messages.filter(
              (m) => !transientMessageIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
            ),
            isStreaming: false,
            streamingMessageId: null,
            pendingApproval: null,
            pendingApprovals: [],
            approvalHistory: [],
            error: state.error ?? { message: err.message || '发送消息失败', recoverableActions: [{ label: '重试', action: () => { void get().sendMessage(projectId, content, overrides, targetSessionId, options); } }] },
          }));
        }
      }
    } catch (err: any) {
      const release = transitionRegistry({
        type: 'release',
        conversationId: sessionId,
        requestId: assistantMsgId,
      });
      if (release.ok && release.applied && get().activeSessionId === sessionId) {
        set({
          isStreaming: false,
          streamingMessageId: null,
          error: { message: err.message || '发送消息失败', recoverableActions: [{ label: '重试', action: () => { void get().sendMessage(projectId, content, overrides, targetSessionId, options); } }] },
        });
      }
    }
    return { ok: true };
  },

  resolveApproval: async (decision, editedArgs, approvalId) => {
    const { streamingMessageId, pendingApproval, pendingApprovals } = get();
    const selectedApproval = approvalId
      ? pendingApprovals.find((item) => item.id === approvalId) ?? null
      : pendingApproval;
    if (!selectedApproval) return;

    const isWorkflowStageGate = selectedApproval.actions.length === 1
      && selectedApproval.actions[0].name === 'advance_stage';
    if (isWorkflowStageGate) {
      if (decision === 'edit') {
        set({ error: { message: '阶段门禁仅支持批准或打回。' } });
        return;
      }
      try {
        await window.electronAPI.workflowRun.resolveStageGate(selectedApproval.id, {
          decision: decision === 'approve' ? 'approve' : 'reject',
          feedback: decision === 'reject' ? '用户打回了当前阶段，请继续完善。' : undefined,
        });
        set((state) => {
          const next = state.pendingApprovals.filter((item) => item.id !== selectedApproval.id);
          return { pendingApprovals: next, pendingApproval: next[0] ?? null };
        });
      } catch (err: unknown) {
        set({ error: { message: err instanceof Error ? err.message : String(err) } });
      }
      return;
    }

    if (!streamingMessageId) return;
    let editedAction: unknown;
    if (decision === 'edit') {
      try {
        editedAction = editedArgs ? JSON.parse(editedArgs) : undefined;
      } catch (err: any) {
        set({ error: { message: err.message || '审批参数不是合法 JSON' } });
        return;
      }
    }

    await window.electronAPI.llm.resolveApproval(streamingMessageId, {
      approvalId: selectedApproval.id,
      decisions: selectedApproval.actions.map((action) => ({
        type: decision,
        editedAction: decision === 'edit' ? { name: action.name, args: editedAction } : undefined,
        message: decision === 'reject' ? '用户拒绝了该工具调用。' : undefined,
      })),
    });
  },

  stopMessage: async () => {
    const { streamingMessageId } = get();
    if (!streamingMessageId) return;
    try {
      await window.electronAPI.llm.stopChat(streamingMessageId);
    } catch (err: any) {
      console.error('Failed to stop chat message streaming:', err);
    }
  },
  checkContextThreshold: async () => {},

  clearError: () => set({ error: null }),

  updateMessageThinkDuration: (messageId: string, seconds: number) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, think_duration_seconds: seconds } : m
      ),
    }));
    if (typeof window.electronAPI?.db?.updateMessageThinkDuration === 'function') {
      window.electronAPI.db.updateMessageThinkDuration(messageId, seconds).catch((err: unknown) => {
        console.error('Failed to persist think duration:', err);
      });
    }
  },
  });
});
