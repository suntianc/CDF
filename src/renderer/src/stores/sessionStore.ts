import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import {
  createConversationRuntimeState,
  projectConversationRuntime,
  restoreConversationRuntime,
  type ConversationRuntimeProjectionEffect,
  type ConversationRuntimeProjectionState,
} from '../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import {
  AgentApprovalRequest,
  AgentRun,
  AgentToolCall,
  ChatRuntimeOverrides,
  ExecutionStep,
  LLMStreamEvent,
  Message,
  Session,
  TodoItem,
} from '../../../shared/types';

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
  recoverableActions?: { label: string; action: () => void }[];
}

export interface ParallelWorker {
  workerId?: string;    // 运行时唯一 ID，解决同 batch 同 agentSlug 碰撞
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
  error: SessionError | null;
  // D-02/D-04/D-05: per-session user goal (in-memory, persists across switches)
  sessionGoals: Map<string, string>;
  // 08.2 P3 C1-05: per-session /goal judge status (iteration + reason).
  // P6 pitfall (session leak): status is keyed by sessionId and NOT cleared
  // on session switch — goal is sticky per P6 lock. ChatArea/GoalSystemBubble
  // filter by activeSessionId at render time.
  goalJudgeStatus: Map<string, GoalJudgeStatusEntry>;
  sessionModelOverrides: Record<string, { providerId: string; model: string }>;
  setSessionModelOverride: (sessionId: string, providerId: string, model: string) => void;
  fetchSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  fetchAgentActivity: (sessionId: string, force?: boolean) => Promise<void>;
  sendMessage: (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => Promise<void>;
  getMessagesForSession: (sessionId: string) => Message[];
  getIsSessionStreaming: (sessionId: string) => boolean;
  setSessionGoal: (sessionId: string, goal: string) => void;
  setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => void;
  getGoalJudgeStatus: (sessionId: string) => GoalJudgeStatusEntry | undefined;
  clearGoalJudgeStatus: (sessionId: string) => void;
  viewingSubagentId: string | null;
  setViewingSubagent: (id: string | null) => void;
  viewingParallelWorker: { batchId: string; agentSlug: string; workerId?: string } | null;
  setViewingParallelWorker: (key: { batchId: string; agentSlug: string; workerId?: string } | null) => void;
  resolveApproval: (decision: 'approve' | 'reject' | 'edit', editedArgs?: string) => Promise<void>;
  stopMessage: () => Promise<void>;
  checkContextThreshold: (projectId: string) => Promise<void>;
  clearError: () => void;
  updateMessageThinkDuration: (messageId: string, seconds: number) => void;
}

type StreamingSessionState = ConversationRuntimeProjectionState;

const streamingSessionsCache = new Map<string, StreamingSessionState>();
interface ActivityFetchEntry {
  requestId: number;
  promise: Promise<void>;
}
const activityFetches = new Map<string, ActivityFetchEntry>();
const latestActivityFetchRequestIds = new Map<string, number>();
let latestSelectSessionRequestId = 0;
let nextActivityFetchRequestId = 0;

interface SendMessageOptions {
  hiddenUserMessage?: boolean;
  imageBase64?: string[];
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
  error: null,
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

  setSessionModelOverride: (sessionId: string, providerId: string, model: string) => {
    set((state) => {
      const nextOverrides = {
        ...state.sessionModelOverrides,
        [sessionId]: { providerId, model },
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

  createSession: async (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => {
    try {
      const newSession = await window.electronAPI.db.createSession(projectId, name, parentSessionId, summary, agentId);
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

      const { activeSessionId } = get();
      if (activeSessionId) {
        await get().selectSession(activeSessionId);
      } else {
        set({ messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], parallelBatches: [], todos: [], activeRunId: null, pendingApproval: null });
      }
    } catch (err: any) {
      set({ error: { message: err.message || 'Failed to delete session' } });
    }
  },
 
  selectSession: async (sessionId: string | null) => {
    const requestId = ++latestSelectSessionRequestId;
    if (!sessionId) {
      set({ activeSessionId: null, messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], parallelBatches: [], todos: [], activeRunId: null, pendingApproval: null, error: null, isStreaming: false, streamingMessageId: null, viewingSubagentId: null, viewingParallelWorker: null });
      return;
    }
    try {
      const cached = streamingSessionsCache.get(sessionId);
      if (cached) {
        set({
          activeSessionId: sessionId,
          messages: cached.messages,
          todos: cached.todos,
          delegatedTasks: cached.delegatedTasks,
          parallelBatches: cached.parallelBatches,
          agentRuns: cached.agentRuns,
          agentToolCalls: cached.agentToolCalls,
          activeRunId: cached.activeRunId,
          pendingApproval: cached.pendingApproval,
          isStreaming: cached.isStreaming,
          streamingMessageId: cached.streamingMessageId,
          error: null,
          viewingSubagentId: null,
        });
      } else {
        set({ error: null });
        const messagesBeforeLoad = get().activeSessionId === sessionId ? get().messages : null;

        let messages: Message[] | null = null;
        let messageError: any = null;
        try {
          messages = await window.electronAPI.db.getMessages(sessionId);
        } catch (err: any) {
          messageError = err;
        }

        if (latestSelectSessionRequestId !== requestId) return;

        if (messages) {
          const cachedDuringLoad = streamingSessionsCache.get(sessionId);
          const messagesChangedDuringLoad = messagesBeforeLoad !== null && get().messages !== messagesBeforeLoad;
          if (cachedDuringLoad) {
            set({
              activeSessionId: sessionId,
              messages: cachedDuringLoad.messages,
              todos: cachedDuringLoad.todos,
              delegatedTasks: cachedDuringLoad.delegatedTasks,
              parallelBatches: cachedDuringLoad.parallelBatches,
              agentRuns: cachedDuringLoad.agentRuns,
              agentToolCalls: cachedDuringLoad.agentToolCalls,
              activeRunId: cachedDuringLoad.activeRunId,
              pendingApproval: cachedDuringLoad.pendingApproval,
              isStreaming: cachedDuringLoad.isStreaming,
              streamingMessageId: cachedDuringLoad.streamingMessageId,
              error: null,
              viewingSubagentId: null,
              viewingParallelWorker: null,
            });
          } else if (messagesChangedDuringLoad) {
            set({
              activeSessionId: sessionId,
              error: null,
            });
          } else {
            set({
              activeSessionId: sessionId,
              messages,
              agentRuns: [],
              agentToolCalls: [],
              delegatedTasks: [],
              parallelBatches: [],
              todos: [],
              error: null,
              isStreaming: false,
              streamingMessageId: null,
              activeRunId: null,
              pendingApproval: null,
            });
          }
        } else {
          set({ error: { message: messageError?.message || 'Failed to load messages for session' } });
        }

        if (get().activeSessionId === sessionId) {
          try {
            await get().fetchAgentActivity(sessionId, true);
          } catch {
            // fetchAgentActivity already records the more specific activity-load error.
          }
        }
      }
    } catch (err: any) {
      if (latestSelectSessionRequestId === requestId) {
        set({ error: { message: err.message || 'Failed to load messages for session' } });
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
        const activeRun = runs[0] || null;
        const toolCalls = activeRun ? await window.electronAPI.db.getAgentToolCalls(activeRun.id) : [];
        const historicalToolCalls = runs.length > 1
          ? (await Promise.all(runs.slice(1).map((run) => window.electronAPI.db.getAgentToolCalls(run.id)))).flat()
          : [];
        const messageToolCalls = [...toolCalls, ...historicalToolCalls];

        // Detect stale running state: if the session is not currently streaming,
        // any task still marked 'running' in DB is likely a crash or disconnect leftover.
        const isSessionStreaming = streamingSessionsCache.has(sessionId);

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
          latestTodos,
        });
        const tasks = restoredRuntime.delegatedTasks;

        if (get().activeSessionId !== sessionId || latestActivityFetchRequestIds.get(sessionId) !== requestId) return;

        // Preserve live chunks from streaming cache and current store state.
        // DB-reconstructed tasks always have chunks: [] (streaming chunks are
        // transient and not persisted to SQLite). Merging from both sources
        // prevents "0 块 / 0 tokens" flash on every reopen / session switch.
        const streamCache = streamingSessionsCache.get(sessionId);
        const storeTasks = get().delegatedTasks ?? [];

        for (const t of tasks) {
          // Prefer streaming cache chunks (most recent), fall back to current
          // store chunks (may survive a brief cache deletion window), then keep
          // the DB-derived empty array as last resort.
          const streamCached = streamCache?.delegatedTasks?.find(c => c.taskId === t.taskId);
          const storeTask = storeTasks.find(s => s.taskId === t.taskId);

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

        set({
          messages,
          agentRuns: restoredRuntime.agentRuns,
          agentToolCalls: restoredRuntime.agentToolCalls,
          delegatedTasks: tasks,
          parallelBatches: restoredRuntime.parallelBatches,
          todos: restoredRuntime.todos,
          activeRunId: restoredRuntime.activeRunId,
        });
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
    return streamingSessionsCache.get(sessionId)?.messages ?? [];
  },

  getIsSessionStreaming: (sessionId: string) => {
    if (get().activeSessionId === sessionId) return get().isStreaming;
    return streamingSessionsCache.get(sessionId)?.isStreaming ?? false;
  },


  sendMessage: async (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => {
    const { activeSessionId, sessions } = get();
    const sessionId = targetSessionId ?? activeSessionId;
    if (!sessionId) return;
    const cachedSession = streamingSessionsCache.get(sessionId);
    const isSessionStreaming = sessionId === activeSessionId ? get().isStreaming : cachedSession?.isStreaming;
    if (isSessionStreaming) return;
    const activeSession = sessions.find((session) => session.id === sessionId);

    // Clear old todos immediately to prevent stale data flashing
    set({ todos: [] });

    const userMsgId = window.crypto.randomUUID();
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

    try {
      if (!options?.hiddenUserMessage) {
        await window.electronAPI.db.saveMessage(userMsg);
      }

      // Append User message and placeholder Assistant message
      const assistantMsgId = window.crypto.randomUUID();
      const assistantMsgPlaceholder: Message = {
        id: assistantMsgId,
        session_id: sessionId,
        role: 'assistant',
        content: '',
        tokens: 0,
        created_at: Date.now(),
      };

      const baseMessages = get().getMessagesForSession(sessionId);
      const initialState: StreamingSessionState = createConversationRuntimeState({
        sessionId,
        streamingMessageId: assistantMsgId,
        currentAssistantMsgId: assistantMsgId,
        messages: [
          ...baseMessages,
          ...(options?.hiddenUserMessage ? [] : [userMsg]),
          assistantMsgPlaceholder,
        ],
        todos: [],
        delegatedTasks: [],
        parallelBatches: [],
        agentRuns: [],
        agentToolCalls: [],
        activeRunId: null,
        pendingApproval: null,
        isStreaming: true,
        accumulatedContent: '',
        pendingToolMessages: {},
        runtimeToolMessageIds: [],
      });

      streamingSessionsCache.set(sessionId, initialState);

      if (activeSessionId === sessionId) {
        set(initialState);
      }

      let cleanup = () => {};
      let parallelCleanup = () => {};
      const projectionDeps = {
        now: () => Date.now(),
        createId: () => window.crypto.randomUUID(),
        estimateTokens,
      };

      const syncActiveSession = (nextState: StreamingSessionState) => {
        if (get().activeSessionId === sessionId) {
          set({
            messages: nextState.messages,
            todos: nextState.todos,
            delegatedTasks: nextState.delegatedTasks,
            parallelBatches: nextState.parallelBatches,
            agentRuns: nextState.agentRuns,
            agentToolCalls: nextState.agentToolCalls,
            activeRunId: nextState.activeRunId,
            pendingApproval: nextState.pendingApproval,
            isStreaming: nextState.isStreaming,
            streamingMessageId: nextState.streamingMessageId,
          });
        }
      };

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
          try {
            await window.electronAPI.db.saveMessage(effect.message);
          } catch (err: any) {
            console.error('Failed to save runtime projection message:', err);
            if (get().activeSessionId === sessionId) {
              set({ error: { message: err?.message || '消息保存失败，对话历史可能不完整' } });
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
          if (get().activeSessionId === sessionId) {
            set({
              error: {
                message: effect.message || '对话请求出错',
                recoverableActions: [{ label: '重试', action: () => get().sendMessage(projectId, content, overrides, targetSessionId) }],
              },
            });
          }
          return false;
        }

        if (effect.type === 'resolveStream') {
          syncActiveSession(nextState);
          streamingSessionsCache.delete(sessionId);
          resolve();
          return true;
        }

        if (effect.type === 'rejectStream') {
          syncActiveSession(nextState);
          streamingSessionsCache.delete(sessionId);
          reject(new Error(effect.error || '对话请求出错'));
          return true;
        }

        return false;
      };

      parallelCleanup = window.electronAPI.deepagents.onParallelTaskStep(sessionId, (_event: unknown, data: { batchId: string; agentSlug: string; workerId: string; step: ExecutionStep }) => {
        const cached = streamingSessionsCache.get(sessionId);
        if (!cached) return;
        const result = projectConversationRuntime(cached, { kind: 'parallelTaskStep', event: data }, projectionDeps);
        streamingSessionsCache.set(sessionId, result.state);
        syncActiveSession(result.state);
      });

      const streamPromise = new Promise<void>((resolve, reject) => {
        let streamEventQueue = Promise.resolve();

        const processStreamEvent = async (data: LLMStreamEvent) => {
          const cached = streamingSessionsCache.get(sessionId);
          if (!cached) return;
          const result = projectConversationRuntime(cached, { kind: 'llm', event: data }, projectionDeps);
          streamingSessionsCache.set(sessionId, result.state);

          let terminal = false;
          for (const effect of result.effects) {
            terminal = await executeRuntimeProjectionEffect(effect, result.state, resolve, reject) || terminal;
          }

          if (!terminal) {
            syncActiveSession(result.state);
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
      const finalOverrides = {
        providerId: sessionModelOverride.providerId || undefined,
        model: sessionModelOverride.model || undefined,
        ...overrides,
      };

      try {
        await window.electronAPI.llm.chat(assistantMsgId, {
          projectId,
          sessionId,
          agentId: activeSession?.agent_id || undefined,
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
        const cached = streamingSessionsCache.get(sessionId);
        const transientMessageIds = new Set([
          assistantMsgId,
          cached?.currentAssistantMsgId,
          ...Object.values(cached?.pendingToolMessages ?? {}).flat(),
          ...(cached?.runtimeToolMessageIds ?? []),
        ].filter(Boolean));
        if (cached) {
          cached.messages = cached.messages.filter(
            (m) => !transientMessageIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
          );
          cached.isStreaming = false;
          cached.streamingMessageId = null;
          cached.pendingApproval = null;
        }
        if (get().activeSessionId === sessionId) {
          set((state) => ({
            messages: state.messages.filter(
              (m) => !transientMessageIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
            ),
            isStreaming: false,
            streamingMessageId: null,
            pendingApproval: null,
            error: { message: err.message || '发送消息失败', recoverableActions: [{ label: '重试', action: () => get().sendMessage(projectId, content, overrides, targetSessionId) }] },
          }));
        }
        streamingSessionsCache.delete(sessionId);
      }
    } catch (err: any) {
      if (get().activeSessionId === sessionId) {
        set({
          isStreaming: false,
          streamingMessageId: null,
          error: { message: err.message || '发送消息失败', recoverableActions: [{ label: '重试', action: () => get().sendMessage(projectId, content, overrides, targetSessionId) }] },
        });
      }
      streamingSessionsCache.delete(sessionId);
    }
  },

  resolveApproval: async (decision, editedArgs) => {
    const { streamingMessageId, pendingApproval } = get();
    if (!streamingMessageId || !pendingApproval) return;

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
      approvalId: pendingApproval.id,
      decisions: pendingApproval.actions.map((action) => ({
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
}));
