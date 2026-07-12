import { useCallback } from 'react';
import type { CommandDispatchAction, ConversationModelSourceType, SlashCommand } from '@shared/types';
import type { ReasoningEffort } from '@shared/ai-subscriptions';
import type { ComposerInputController } from './useComposerInputController';
import type { ComposerInputMode } from './composerInput';

export type ComposerSubmissionResult =
  | { type: 'noop' }
  | { type: 'submittedConversation' }
  | { type: 'dispatchedCommand' }
  | {
      type: 'failed';
      phase: 'createConversation' | 'sendConversation' | 'dispatchCommand';
      error: unknown;
    };

export interface UseComposerSubmissionControllerOptions {
  composerInput: ComposerInputController;
  mode: ComposerInputMode;
  activeSessionId: string | null;
  currentProjectId: string | null;
  isStreaming: boolean;
  selectedSourceType: ConversationModelSourceType;
  selectedSourceId: string;
  selectedModel: string;
  selectedReasoningEffort?: ReasoningEffort;
  commands: ReadonlyArray<SlashCommand>;
  resolveCommand: (
    input: string,
    commands: ReadonlyArray<SlashCommand>
  ) => CommandDispatchAction | null;
  dispatchCommand: (plan: CommandDispatchAction) => Promise<void>;
  createSession: (projectId: string, name: string) => Promise<{ id: string }>;
  selectSession: (sessionId: string | null) => Promise<void>;
  fetchSessions: (projectId: string) => Promise<void>;
  sendMessage: (
    projectId: string,
    content: string,
    overrides?: {
      modelSource?: ConversationModelSourceType;
      sourceId?: string;
      providerId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
    },
    targetSessionId?: string,
    options?: { imageBase64?: string[] }
  ) => Promise<void | { ok: true } | { ok: false; code: 'CONVERSATION_BUSY' }>;
  getWelcomeModelOverride: () => {
    providerId: string;
    sourceId?: string;
    sourceType?: ConversationModelSourceType;
    model: string;
    reasoningEffort?: ReasoningEffort;
  } | null;
  setSessionModelOverride: (
    sessionId: string,
    sourceId: string,
    model: string,
    sourceType?: ConversationModelSourceType
  ) => void;
  setSessionReasoningEffort?: (sessionId: string, effort?: ReasoningEffort) => void;
  t: (key: string) => string;
}

export function useComposerSubmissionController({
  composerInput,
  mode,
  currentProjectId,
  isStreaming,
  selectedSourceType,
  selectedSourceId,
  selectedModel,
  selectedReasoningEffort,
  commands,
  resolveCommand,
  dispatchCommand,
  createSession,
  selectSession,
  fetchSessions,
  sendMessage,
  getWelcomeModelOverride,
  setSessionModelOverride,
  setSessionReasoningEffort,
  t,
}: UseComposerSubmissionControllerOptions) {
  const createConversationDraftName = useCallback(
    (draftText: string, attachmentCount: number) =>
      draftText.trim().slice(0, 15) ||
      (attachmentCount > 0 ? '图片对话' : t('chat.newSessionFallback')),
    [t]
  );

  const prepareWelcomeConversation = useCallback(
    async (draftText: string, attachmentCount: number) => {
      if (!currentProjectId) return;

      const conversation = await createSession(
        currentProjectId,
        createConversationDraftName(draftText, attachmentCount)
      );
      const welcomeOverride = getWelcomeModelOverride();
      if (welcomeOverride) {
        setSessionModelOverride(
          conversation.id,
          welcomeOverride.sourceId || welcomeOverride.providerId,
          welcomeOverride.model,
          welcomeOverride.sourceType || 'llm_provider'
        );
        if (welcomeOverride.reasoningEffort) {
          setSessionReasoningEffort?.(conversation.id, welcomeOverride.reasoningEffort);
          setSessionReasoningEffort?.('', undefined);
        }
        setSessionModelOverride('', '', '', 'llm_provider');
      }
      await selectSession(conversation.id);
      await fetchSessions(currentProjectId);
    },
    [
      createConversationDraftName,
      createSession,
      currentProjectId,
      fetchSessions,
      getWelcomeModelOverride,
      selectSession,
      setSessionModelOverride,
      setSessionReasoningEffort,
    ]
  );

  const submit = useCallback(async (): Promise<ComposerSubmissionResult> => {
    if (isStreaming) return { type: 'noop' };
    if (!currentProjectId) return { type: 'noop' };

    const draftText = composerInput.text;
    const intent = composerInput.submit();
    if (intent.type === 'noop') return { type: 'noop' };

    if (intent.type === 'executeCommand') {
      if (mode === 'welcome') {
        try {
          await prepareWelcomeConversation(draftText, 0);
        } catch (error) {
          return { type: 'failed', phase: 'createConversation', error };
        }
      }

      try {
        await dispatchCommand(intent.plan);
        return { type: 'dispatchedCommand' };
      } catch (error) {
        return { type: 'failed', phase: 'dispatchCommand', error };
      }
    }

    if (mode === 'welcome') {
      try {
        await prepareWelcomeConversation(draftText, intent.attachments.length);
      } catch (error) {
        return { type: 'failed', phase: 'createConversation', error };
      }
    }

    try {
      const result = await sendMessage(
        currentProjectId,
        intent.content,
        {
          modelSource: selectedSourceId ? selectedSourceType : undefined,
          sourceId: selectedSourceId || undefined,
          providerId: selectedSourceType === 'llm_provider' ? selectedSourceId || undefined : undefined,
          model: selectedModel || undefined,
          ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
        },
        undefined,
        { imageBase64: intent.attachments.length ? intent.attachments : undefined }
      );
      return result && !result.ok
        ? { type: 'failed', phase: 'sendConversation', error: result }
        : { type: 'submittedConversation' };
    } catch (error) {
      return { type: 'failed', phase: 'sendConversation', error };
    }
  }, [
    commands,
    composerInput,
    createConversationDraftName,
    createSession,
    currentProjectId,
    dispatchCommand,
    fetchSessions,
    getWelcomeModelOverride,
    isStreaming,
    mode,
    prepareWelcomeConversation,
    resolveCommand,
    selectedModel,
    selectedReasoningEffort,
    selectedSourceId,
    selectedSourceType,
    selectSession,
    sendMessage,
    setSessionModelOverride,
  ]);

  const selectCommandEntry = useCallback(
    async (commandText: string): Promise<ComposerSubmissionResult> => {
      const plan = resolveCommand(commandText, commands);
      if (plan && mode === 'session') {
        composerInput.reset();
        try {
          await dispatchCommand(plan);
          return { type: 'dispatchedCommand' };
        } catch (error) {
          return { type: 'failed', phase: 'dispatchCommand', error };
        }
      }

      composerInput.insertCommand(commandText);
      return { type: 'noop' };
    },
    [commands, composerInput, dispatchCommand, mode, resolveCommand]
  );

  return {
    submit,
    selectCommandEntry,
  };
}
