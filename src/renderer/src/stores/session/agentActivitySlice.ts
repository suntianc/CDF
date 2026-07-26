import type { TodoItem } from '@shared/types';
import { restoreConversationRuntime } from '../../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import { getConversationRuntimeEntry, mergeConversationRuntimeMessages } from '../../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import {
  mergeDelegatedTaskRuntime,
  parseLatestTodosOutput,
  reconcilePersistedToolMessages,
} from './agentActivity';
import type { SessionSliceContext, SessionState } from './types';

export type AgentActivitySlice = Pick<SessionState,
  | 'fetchAgentActivity'
  | 'viewingSubagentId'
  | 'setViewingSubagent'
  | 'viewingParallelWorker'
  | 'setViewingParallelWorker'
>;

interface ActivityFetchEntry {
  requestId: number;
  promise: Promise<void>;
}

export function createAgentActivitySlice({ set, get, registry }: SessionSliceContext): AgentActivitySlice {
  const { transitionRegistry } = registry;
  const activityFetches = new Map<string, ActivityFetchEntry>();
  const latestActivityFetchRequestIds = new Map<string, number>();
  let nextActivityFetchRequestId = 0;

  return {
    viewingSubagentId: null,
    setViewingSubagent: (id) => set({ viewingSubagentId: id, viewingParallelWorker: null }),
    viewingParallelWorker: null,
    setViewingParallelWorker: (key) => set({ viewingParallelWorker: key, viewingSubagentId: null }),

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
              latestTodos = parseLatestTodosOutput(lastTodosToolCall?.output);
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

          if (get().activeSessionId !== sessionId || latestActivityFetchRequestIds.get(sessionId) !== requestId) return;

          const streamProjection = getConversationRuntimeEntry(
            get().conversationRuntimeRegistry,
            sessionId,
          )?.projection;
          const tasks = mergeDelegatedTaskRuntime(
            restoredRuntime.delegatedTasks,
            streamProjection?.delegatedTasks,
            get().delegatedTasks ?? [],
          );

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
  };
}
