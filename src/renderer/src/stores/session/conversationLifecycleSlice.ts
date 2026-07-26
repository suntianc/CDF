import { CONVERSATION_DELETE_ERROR_CODES } from '@shared/conversation-deletion';
import type { Message } from '@shared/types';
import {
  getConversationRuntimeEntry,
  mergeConversationRuntimeMessages,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import { persistSessionModelOverrides } from './modelOverridesSlice';
import type { SessionSliceContext, SessionState } from './types';

export type ConversationLifecycleSlice = Pick<SessionState,
  | 'sessions'
  | 'activeSessionId'
  | 'fetchSessions'
  | 'createSession'
  | 'deleteSession'
  | 'selectSession'
>;

export function createConversationLifecycleSlice(
  { set, get, registry }: SessionSliceContext,
): ConversationLifecycleSlice {
  const { projectionPatch, publishRegistryEntry, transitionRegistry } = registry;
  let latestSelectSessionRequestId = 0;

  return {
    sessions: [],
    activeSessionId: null,

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
        // Stop any running /goal judge loop first, so the delete-induced streaming flip can't
        // fire a judge that sendMessages into a conversation being removed, and the module-level
        // subscription isn't leaked. Dynamic import avoids a static import cycle with useGoalJudge.
        const { stopGoalJudgeLoop } = await import('@/hooks/useGoalJudge');
        await stopGoalJudgeLoop(sessionId);

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
          persistSessionModelOverrides(nextOverrides);

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
  };
}
