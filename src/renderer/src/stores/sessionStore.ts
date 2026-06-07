import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import {
  AgentApprovalRequest,
  AgentRun,
  AgentToolCall,
  ChatRuntimeOverrides,
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

export interface DelegatedTask {
  taskId: string;
  agentSlug: string;
  agentName: string;
  goal: string;
  status: 'running' | 'success' | 'failure';
  chunks: string[];
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
  todos: TodoItem[];
  pendingApproval: AgentApprovalRequest | null;
  error: string | null;
  // D-02/D-04/D-05: per-session user goal (in-memory, persists across switches)
  sessionGoals: Map<string, string>;
  // 08.2 P3 C1-05: per-session /goal judge status (iteration + reason).
  // P6 pitfall (session leak): status is keyed by sessionId and NOT cleared
  // on session switch — goal is sticky per P6 lock. ChatArea/GoalSystemBubble
  // filter by activeSessionId at render time.
  goalJudgeStatus: Map<string, GoalJudgeStatusEntry>;
  fetchSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  fetchAgentActivity: (sessionId: string) => Promise<void>;
  sendMessage: (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => Promise<void>;
  getMessagesForSession: (sessionId: string) => Message[];
  getIsSessionStreaming: (sessionId: string) => boolean;
  setSessionGoal: (sessionId: string, goal: string) => void;
  setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => void;
  getGoalJudgeStatus: (sessionId: string) => GoalJudgeStatusEntry | undefined;
  clearGoalJudgeStatus: (sessionId: string) => void;
  resolveApproval: (decision: 'approve' | 'reject' | 'edit', editedArgs?: string) => Promise<void>;
  stopMessage: () => Promise<void>;
  checkContextThreshold: (projectId: string) => Promise<void>;
  clearError: () => void;
}

interface StreamingSessionState {
  messages: Message[];
  todos: TodoItem[];
  delegatedTasks: DelegatedTask[];
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  activeRunId: string | null;
  pendingApproval: AgentApprovalRequest | null;
  isStreaming: boolean;
  streamingMessageId: string | null;
}

const streamingSessionsCache = new Map<string, StreamingSessionState>();

interface SendMessageOptions {
  hiddenUserMessage?: boolean;
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
  todos: [],
  pendingApproval: null,
  error: null,
  sessionGoals: new Map(),
  goalJudgeStatus: new Map(),

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
      set({ error: err.message || 'Failed to fetch sessions' });
    }
  },

  createSession: async (projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => {
    try {
      const newSession = await window.electronAPI.db.createSession(projectId, name, parentSessionId, summary, agentId);
      await get().fetchSessions(projectId);
      return newSession;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create session' });
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
        return {
          sessions: remaining,
          activeSessionId: nextActive,
          sessionGoals: nextGoals,
          goalJudgeStatus: nextJudge,
        };
      });

      const { activeSessionId } = get();
      if (activeSessionId) {
        await get().selectSession(activeSessionId);
      } else {
        set({ messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], todos: [], activeRunId: null, pendingApproval: null });
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete session' });
    }
  },
 
  selectSession: async (sessionId: string | null) => {
    if (!sessionId) {
      set({ activeSessionId: null, messages: [], agentRuns: [], agentToolCalls: [], delegatedTasks: [], todos: [], activeRunId: null, pendingApproval: null, error: null, isStreaming: false, streamingMessageId: null });
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
          agentRuns: cached.agentRuns,
          agentToolCalls: cached.agentToolCalls,
          activeRunId: cached.activeRunId,
          pendingApproval: cached.pendingApproval,
          isStreaming: cached.isStreaming,
          streamingMessageId: cached.streamingMessageId,
          error: null,
        });
      } else {
        const messages = await window.electronAPI.db.getMessages(sessionId);
        set({
          activeSessionId: sessionId,
          messages,
          delegatedTasks: [],
          todos: [],
          error: null,
          isStreaming: false,
          streamingMessageId: null,
          activeRunId: null,
          pendingApproval: null,
        });
        await get().fetchAgentActivity(sessionId);
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to load messages for session' });
    }
  },

  fetchAgentActivity: async (sessionId: string) => {
    try {
      if (
        typeof window.electronAPI.db.getAgentRuns !== 'function' ||
        typeof window.electronAPI.db.getAgentToolCalls !== 'function'
      ) {
        set({ agentRuns: [], agentToolCalls: [], delegatedTasks: [], activeRunId: null });
        return;
      }
      const runs = await window.electronAPI.db.getAgentRuns(sessionId);
      const activeRun = runs[0] || null;
      const toolCalls = activeRun ? await window.electronAPI.db.getAgentToolCalls(activeRun.id) : [];

      const tasks: DelegatedTask[] = [];
      for (const call of toolCalls) {
        if (call.tool_name === 'task') {
          let agentSlug = 'unknown';
          let goal = '';
          try {
            const input = call.input ? JSON.parse(call.input) : {};
            agentSlug = input.subagent_type || input.name || 'unknown';
            if (input.task) {
              try {
                const taskPackage = JSON.parse(input.task);
                goal = taskPackage.goal || '';
              } catch {
                goal = input.name || '任务执行';
              }
            } else if (input.description) {
              goal = input.description;
            }
          } catch (e) {
            console.warn('[sessionStore] Failed to parse task tool call input:', call.input, e);
          }

          let status: 'running' | 'success' | 'failure' = 'success';
          let errorCode: string | undefined;
          let parsedResult: any;

          if (call.status === 'running') {
            status = 'running';
          } else if (call.status === 'error') {
            status = 'failure';
            errorCode = 'UNKNOWN';
            const msg = call.error || '';
            if (msg.toLowerCase().includes('timeout')) errorCode = 'TIMEOUT';
            else if (msg.toLowerCase().includes('interrupt') || msg.toLowerCase().includes('cancel')) errorCode = 'INTERRUPTED';
            parsedResult = {
              status: 'failure',
              artifacts: [],
              summary: '',
              error: { code: errorCode, message: msg }
            };
          } else {
            try {
              const rawOutput = typeof call.output === 'string' ? call.output : JSON.stringify(call.output);
              const parsedOutput = JSON.parse(rawOutput);
              if (parsedOutput && typeof parsedOutput === 'object') {
                if (parsedOutput.status === 'failure') {
                  status = 'failure';
                  errorCode = parsedOutput.error?.code || 'PARSE_FAILED';
                  parsedResult = parsedOutput;
                } else if (parsedOutput.summary !== undefined) {
                  status = 'success';
                  parsedResult = parsedOutput;
                } else {
                  if (parsedOutput.lg_name === 'Command' && parsedOutput.update?.messages?.length > 0) {
                    const toolMsg = parsedOutput.update.messages[parsedOutput.update.messages.length - 1];
                    const content = typeof toolMsg === 'object' ? toolMsg.kwargs?.content : toolMsg;
                    if (typeof content === 'string') {
                      try {
                        parsedResult = JSON.parse(content);
                        if (parsedResult.status === 'failure') {
                          status = 'failure';
                          errorCode = parsedResult.error?.code || 'PARSE_FAILED';
                        }
                      } catch {
                        parsedResult = { status: 'success', artifacts: [], summary: content.slice(0, 500) };
                      }
                    } else {
                      parsedResult = { status: 'success', artifacts: [], summary: '任务执行完成' };
                    }
                  } else {
                    parsedResult = { status: 'success', artifacts: [], summary: '任务执行完成' };
                  }
                }
              }
            } catch (e: any) {
              status = 'failure';
              errorCode = 'PARSE_FAILED';
              parsedResult = {
                status: 'failure',
                artifacts: [],
                summary: '',
                error: { code: 'PARSE_FAILED', message: e?.message || 'unknown parse error' }
              };
            }
          }

          tasks.push({
            taskId: call.id,
            agentSlug,
            agentName: agentSlug,
            goal,
            status,
            chunks: [],
            result: parsedResult,
            errorCode,
            startedAt: call.started_at,
            completedAt: call.ended_at || undefined
          });
        }
      }
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

      set({
        agentRuns: runs,
        agentToolCalls: toolCalls,
        delegatedTasks: tasks,
        todos: latestTodos,
        activeRunId: activeRun?.id || null,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load agent activity' });
    }
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
      const initialState: StreamingSessionState = {
        messages: [
          ...baseMessages,
          ...(options?.hiddenUserMessage ? [] : [userMsg]),
          assistantMsgPlaceholder,
        ],
        todos: [],
        delegatedTasks: [],
        agentRuns: [],
        agentToolCalls: [],
        activeRunId: null,
        pendingApproval: null,
        isStreaming: true,
        streamingMessageId: assistantMsgId,
      };

      streamingSessionsCache.set(sessionId, initialState);

      if (activeSessionId === sessionId) {
        set(initialState);
      }

      let accumulatedContent = '';
      let cleanup = () => {};
      const pendingToolMessages = new Map<string, string[]>();
      let currentAssistantMsgId = assistantMsgId;

      const streamPromise = new Promise<void>((resolve, reject) => {
        cleanup = window.electronAPI.llm.onChunk(assistantMsgId, async (_event: unknown, data: LLMStreamEvent) => {
          const cached = streamingSessionsCache.get(sessionId);
          if (!cached) return;

          if (data.type === 'todos_update') {
            cached.todos = data.todos;
          }

          else if (data.type === 'run_started') {
            cached.activeRunId = data.runId;
            cached.agentRuns = [
              {
                id: data.runId,
                session_id: sessionId,
                agent_id: data.agentId,
                request_id: assistantMsgId,
                status: data.status,
                started_at: Date.now(),
                ended_at: null,
                aborted: 0,
              },
              ...cached.agentRuns.filter((run) => run.id !== data.runId),
            ];
            cached.agentToolCalls = [];
          }

          else if (data.type === 'run_updated') {
            cached.agentRuns = cached.agentRuns.map((run) =>
              run.id === data.runId ? { ...run, status: data.status, error: data.error || run.error || null, ended_at: ['completed', 'failed', 'aborted'].includes(data.status) ? Date.now() : run.ended_at } : run
            );
          }

          else if (data.type === 'approval_required') {
            cached.pendingApproval = data.approval;
          }

          else if (data.type === 'approval_resolved') {
            cached.pendingApproval = null;
          }

          else if (data.type === 'delegated_task_start') {
            const projectStore = useProjectStore.getState();
            if (projectStore.activeView === 'chat' && get().activeSessionId === sessionId) {
              projectStore.setTaskPanelOpen(true);
            }
            cached.delegatedTasks = [
              ...cached.delegatedTasks,
              {
                taskId: data.taskId,
                agentSlug: data.agentSlug,
                agentName: data.agentName,
                goal: data.goal,
                status: 'running',
                chunks: [],
                startedAt: Date.now(),
              },
            ];
          }

          else if (data.type === 'delegated_task_chunk') {
            cached.delegatedTasks = cached.delegatedTasks.map((task) =>
              task.taskId === data.taskId
                ? { ...task, chunks: [...task.chunks, data.text] }
                : task
            );
          }

          else if (data.type === 'delegated_task_end') {
            cached.delegatedTasks = cached.delegatedTasks.map((task) =>
              task.taskId === data.taskId
                ? {
                    ...task,
                    status: data.status,
                    result: data.result,
                    errorCode: data.errorCode,
                    completedAt: Date.now(),
                  }
                : task
            );
          }

          else if (data.type === 'message_chunk' && data.text) {
            const hasMsg = cached.messages.some((m) => m.id === currentAssistantMsgId);
            if (!hasMsg) {
              const newPlaceholder: Message = {
                id: currentAssistantMsgId,
                session_id: sessionId,
                role: 'assistant',
                content: '',
                tokens: 0,
                created_at: Date.now(),
              };
              cached.messages = [...cached.messages, newPlaceholder];
            }

            accumulatedContent += data.text;
            cached.messages = cached.messages.map((m) =>
              m.id === currentAssistantMsgId ? { ...m, content: accumulatedContent } : m
            );
          }

          else if (data.type === 'tool_start') {
            const projectStore = useProjectStore.getState();
            if (projectStore.activeView === 'chat' && get().activeSessionId === sessionId) {
              projectStore.setTaskPanelOpen(true);
            }
            // 1. 如果上一段助手有说话，将其持久化写入 SQLite
            if (accumulatedContent.trim()) {
              const prevMsg = {
                id: currentAssistantMsgId,
                session_id: sessionId,
                role: 'assistant' as const,
                content: accumulatedContent,
                tokens: estimateTokens(accumulatedContent),
              };
              window.electronAPI.db.saveMessage(prevMsg).catch((err: unknown) => {
                console.error('Failed to save intermediate assistant message:', err);
                if (get().activeSessionId === sessionId) {
                  set({ error: '消息保存失败，对话历史可能不完整' });
                }
              });
            }

            // 2. 插入运行中的工具卡片
            const toolMessageId = data.id || window.crypto.randomUUID();
            if (!data.id) {
              const queue = pendingToolMessages.get(data.name) || [];
              queue.push(toolMessageId);
              pendingToolMessages.set(data.name, queue);
            }

            const toolMsgContent = {
              type: 'tool',
              name: data.name,
              status: 'running',
              input: data.input,
            };

            const toolMsg: Message = {
              id: toolMessageId,
              session_id: sessionId,
              role: 'system',
              content: JSON.stringify(toolMsgContent),
              created_at: Date.now(),
              tokens: 0,
            };

            const hasExistingMsg = cached.messages.some((m) => m.id === toolMessageId);

            if (hasExistingMsg) {
              cached.messages = cached.messages.map((m) =>
                m.id === toolMessageId ? { ...m, content: JSON.stringify(toolMsgContent) } : m
              );
              cached.agentToolCalls = cached.agentToolCalls.map((tc) =>
                tc.id === toolMessageId
                  ? { ...tc, status: 'running', input: JSON.stringify(data.input ?? null) }
                  : tc
              );
            } else {
              cached.messages = [...cached.messages, toolMsg];
              if (data.id) {
                cached.agentToolCalls = [
                  ...cached.agentToolCalls,
                  {
                    id: data.id,
                    run_id: cached.activeRunId || '',
                    tool_name: data.name,
                    input: JSON.stringify(data.input ?? null),
                    output: null,
                    status: 'running',
                    error: null,
                    started_at: Date.now(),
                    ended_at: null,
                    approval_status: null,
                  },
                ];
              }

              window.electronAPI.db.saveMessage(toolMsg).catch((err: unknown) => {
                console.error('Failed to save tool start message:', err);
              });
            }

            // 3. 准备切换下一段助手消息
            currentAssistantMsgId = window.crypto.randomUUID();
            accumulatedContent = '';
          }

          else if (data.type === 'tool_end' || data.type === 'tool_error') {
            let toolMessageId = data.id;
            if (!toolMessageId) {
              const queue = pendingToolMessages.get(data.name) || [];
              toolMessageId = queue.shift();
              pendingToolMessages.set(data.name, queue);
            }

            if (data.type === 'tool_end' && data.name === 'write_todos') {
              try {
                const outputObj = typeof data.output === 'string' ? JSON.parse(data.output) : data.output;
                let todosList = null;
                if (outputObj && typeof outputObj === 'object') {
                  if (Array.isArray(outputObj)) {
                    todosList = outputObj;
                  } else if (outputObj.update && Array.isArray(outputObj.update.todos)) {
                    todosList = outputObj.update.todos;
                  } else if (outputObj.value && typeof outputObj.value === 'object') {
                    const val = outputObj.value;
                    if (val.update && Array.isArray(val.update.todos)) {
                      todosList = val.update.todos;
                    }
                  }
                }
                if (Array.isArray(todosList)) {
                  cached.todos = todosList;
                }
              } catch (err) {
                console.warn('Failed to parse todos from write_todos tool output:', err);
              }
            }

            if (toolMessageId) {
              const isEnd = data.type === 'tool_end';
              
              const currentMsg = cached.messages.find(m => m.id === toolMessageId);
              let parsedContent: any = {};
              if (currentMsg) {
                try {
                  parsedContent = JSON.parse(currentMsg.content);
                } catch (e) {
                  parsedContent = { type: 'tool', name: data.name };
                }
              } else {
                parsedContent = { type: 'tool', name: data.name };
              }

              const newContentObj = {
                ...parsedContent,
                status: isEnd ? 'success' : 'error',
                output: isEnd ? data.output : undefined,
                error: !isEnd ? data.error : undefined,
              };

              const updatedContent = JSON.stringify(newContentObj);

              cached.messages = cached.messages.map((m) =>
                m.id === toolMessageId ? { ...m, content: updatedContent } : m
              );
              cached.agentToolCalls = cached.agentToolCalls.map((toolCall) =>
                toolCall.id === toolMessageId
                  ? {
                      ...toolCall,
                      status: isEnd ? 'success' : 'error',
                      output: isEnd ? JSON.stringify(data.output ?? null) : toolCall.output,
                      error: !isEnd ? data.error : null,
                      ended_at: Date.now(),
                    }
                  : toolCall
              );

              const savedMsg = {
                id: toolMessageId,
                session_id: sessionId,
                role: 'system' as const,
                content: updatedContent,
                created_at: currentMsg?.created_at || Date.now(),
                tokens: 0,
              };

              window.electronAPI.db.saveMessage(savedMsg).catch((err: unknown) => {
                console.error('Failed to save tool output to db:', err);
              });
            }
          }

          else if (data.type === 'message_done') {
            cleanup();
            try {
              if (accumulatedContent.trim()) {
                const assistantTokens = estimateTokens(accumulatedContent);
                const finalAssistantMsg = {
                  id: currentAssistantMsgId,
                  session_id: sessionId,
                  role: 'assistant' as const,
                  content: accumulatedContent,
                  tokens: assistantTokens,
                };

                await window.electronAPI.db.saveMessage(finalAssistantMsg);
                
                cached.messages = cached.messages
                  .map((m) =>
                    m.id === currentAssistantMsgId ? { ...m, tokens: assistantTokens } : m
                  )
                  .filter((m) => !(m.role === 'assistant' && m.content === ''));
              } else {
                cached.messages = cached.messages.filter((m) => !(m.role === 'assistant' && m.content === ''));
              }
              cached.isStreaming = false;
              cached.streamingMessageId = null;
              cached.pendingApproval = null;

              if (get().activeSessionId === sessionId) {
                set({
                  messages: cached.messages,
                  isStreaming: false,
                  streamingMessageId: null,
                  pendingApproval: null,
                  todos: cached.todos,
                  delegatedTasks: cached.delegatedTasks,
                  agentRuns: cached.agentRuns,
                  agentToolCalls: cached.agentToolCalls,
                  activeRunId: cached.activeRunId,
                });
              }
              streamingSessionsCache.delete(sessionId);
              resolve();
            } catch (err: any) {
              console.error('Failed to save message or complete stream:', err);
              cached.messages = cached.messages.filter((m) => !(m.role === 'assistant' && m.content === ''));
              cached.isStreaming = false;
              cached.streamingMessageId = null;
              cached.pendingApproval = null;

              if (get().activeSessionId === sessionId) {
                set({
                  messages: cached.messages,
                  isStreaming: false,
                  streamingMessageId: null,
                  pendingApproval: null,
                  error: err.message || '保存回复消息失败',
                });
              }
              streamingSessionsCache.delete(sessionId);
              reject(err);
            }
            return;
          }

          else if (data.type === 'runtime_error') {
            cleanup();
            const toolMsgIds = new Set([...pendingToolMessages.values()].flat());
            cached.messages = cached.messages.filter(
              (m) => m.id !== assistantMsgId && m.id !== currentAssistantMsgId && !toolMsgIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
            );
            cached.isStreaming = false;
            cached.streamingMessageId = null;
            cached.pendingApproval = null;

            if (get().activeSessionId === sessionId) {
              set({
                messages: cached.messages,
                isStreaming: false,
                streamingMessageId: null,
                pendingApproval: null,
                error: data.error || '对话请求出错',
              });
            }
            streamingSessionsCache.delete(sessionId);
            reject(new Error(data.error || '对话请求出错'));
            return;
          }

          // Sync with Zustand if currently active
          if (get().activeSessionId === sessionId) {
            set({
              messages: cached.messages,
              todos: cached.todos,
              delegatedTasks: cached.delegatedTasks,
              agentRuns: cached.agentRuns,
              agentToolCalls: cached.agentToolCalls,
              activeRunId: cached.activeRunId,
              pendingApproval: cached.pendingApproval,
              isStreaming: cached.isStreaming,
              streamingMessageId: cached.streamingMessageId,
            });
          }
        });
      });

      try {
        await window.electronAPI.llm.chat(assistantMsgId, {
          projectId,
          sessionId,
          agentId: activeSession?.agent_id || undefined,
          message: {
            id: userMsgId,
            content,
          },
          overrides,
        });
        await streamPromise;
      } catch (err: any) {
        cleanup();
        // 移除未持久化的 assistant 占位和工具消息
        const toolMsgIds = new Set([...pendingToolMessages.values()].flat());
        pendingToolMessages.clear();
        const cached = streamingSessionsCache.get(sessionId);
        if (cached) {
          cached.messages = cached.messages.filter(
            (m) => m.id !== assistantMsgId && m.id !== currentAssistantMsgId && !toolMsgIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
          );
          cached.isStreaming = false;
          cached.streamingMessageId = null;
          cached.pendingApproval = null;
        }
        if (get().activeSessionId === sessionId) {
          set((state) => ({
            messages: state.messages.filter(
              (m) => m.id !== assistantMsgId && m.id !== currentAssistantMsgId && !toolMsgIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
            ),
            isStreaming: false,
            streamingMessageId: null,
            pendingApproval: null,
            error: err.message || '发送消息失败',
          }));
        }
        streamingSessionsCache.delete(sessionId);
      }
    } catch (err: any) {
      if (get().activeSessionId === sessionId) {
        set({
          isStreaming: false,
          streamingMessageId: null,
          error: err.message || '发送消息失败',
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
        set({ error: err.message || '审批参数不是合法 JSON' });
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
}));
