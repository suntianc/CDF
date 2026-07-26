// Uses the raw i18next singleton rather than '@/i18n' to avoid eager i18n init
// via import side effects (see runtimeRegistryAdapter.ts).
import i18next from 'i18next';
import type {
  ChatRuntimeOverrides,
  ConversationRunStreamSnapshot,
  ExecutionStep,
  LLMStreamEvent,
  Message,
} from '@shared/types';
import { useProjectStore } from '../projectStore';
import {
  createConversationRuntimeState,
  hydrateConversationRuntimeStream,
  projectConversationRuntime,
  type ConversationRuntimeProjectionEffect,
  type ConversationRuntimeProjectionState,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import {
  createConversationRuntimeRegistryState,
  getConversationRuntimeEntry,
  getConversationRuntimeRequest,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import { estimateTokens } from './estimateTokens';
import type { SendMessageOptions, SessionSliceContext, SessionState } from './types';

type StreamingSessionState = ConversationRuntimeProjectionState;

export type RuntimeStreamSlice = Pick<SessionState,
  | 'messages'
  | 'isStreaming'
  | 'streamingMessageId'
  | 'activeRunId'
  | 'agentRuns'
  | 'agentToolCalls'
  | 'delegatedTasks'
  | 'parallelBatches'
  | 'todos'
  | 'error'
  | 'isConversationLoading'
  | 'conversationRuntimeRegistry'
  | 'sendMessage'
  | 'handleConversationRunEvent'
  | 'handleMessagesChanged'
  | 'hydrateConversationRun'
  | 'getMessagesForSession'
  | 'getIsSessionStreaming'
  | 'stopMessage'
  | 'clearError'
  | 'updateMessageThinkDuration'
>;

export function createRuntimeStreamSlice({ set, get, registry }: SessionSliceContext): RuntimeStreamSlice {
  const { projectionDeps, publishRegistryEntry, transitionRegistry } = registry;

  return {
    messages: [],
    isStreaming: false,
    streamingMessageId: null,
    activeRunId: null,
    agentRuns: [],
    agentToolCalls: [],
    delegatedTasks: [],
    parallelBatches: [],
    todos: [],
    error: null,
    isConversationLoading: false,
    conversationRuntimeRegistry: createConversationRuntimeRegistryState(),

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
      const { activeSessionId } = get();
      const sessionId = targetSessionId ?? activeSessionId;
      if (!sessionId) return { ok: true };

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
                  recoverableActions: [{ label: i18next.t('chat.retry'), action: () => get().sendMessage(projectId, content, overrides, targetSessionId, options) }],
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
              error: state.error ?? { message: err.message || i18next.t('chat.sendMessageFailed'), recoverableActions: [{ label: i18next.t('chat.retry'), action: () => { void get().sendMessage(projectId, content, overrides, targetSessionId, options); } }] },
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
            error: { message: err.message || i18next.t('chat.sendMessageFailed'), recoverableActions: [{ label: i18next.t('chat.retry'), action: () => { void get().sendMessage(projectId, content, overrides, targetSessionId, options); } }] },
          });
        }
      }
      return { ok: true };
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
  };
}
