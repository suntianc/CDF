// Conversation runtime registry machinery for the session store (#235): action
// dispatch, effect execution, and projection publishing. Extracted verbatim from
// the former sessionStore create() closure.
//
// Use the raw i18next singleton (initialized by App via '@/i18n') rather than
// importing '@/i18n' here, so pulling in this module does not eagerly initialize
// i18n — tests that assert on untranslated keys must keep working.
import i18next from 'i18next';
import {
  type ConversationRuntimeProjectionState,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import {
  getConversationRuntimeEntry,
  getConversationRuntimeErrorEntry,
  getConversationRuntimeRequest,
  mergeConversationRuntimeMessages,
  transitionConversationRuntimeRegistry,
  type ConversationRuntimeRegistryAction,
  type ConversationRuntimeRegistryEffect,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import { estimateTokens } from './estimateTokens';
import type { RuntimeRegistryAdapter, SessionSliceContext } from './types';

export function createRuntimeRegistryAdapter(
  set: SessionSliceContext['set'],
  get: SessionSliceContext['get'],
): RuntimeRegistryAdapter {
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
                    label: i18next.t('chat.retry'),
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

  return { projectionDeps, projectionPatch, publishRegistryEntry, transitionRegistry };
}
