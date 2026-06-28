import { useCallback } from 'react';
import type { CommandDispatchAction, SlashCommand } from '@shared/types';
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
  selectedProviderId: string;
  selectedModel: string;
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
    overrides?: { providerId?: string; model?: string },
    targetSessionId?: string,
    options?: { imageBase64?: string[] }
  ) => Promise<void>;
  getWelcomeModelOverride: () => { providerId: string; model: string } | null;
  setSessionModelOverride: (sessionId: string, providerId: string, model: string) => void;
  t: (key: string) => string;
}

export function useComposerSubmissionController({
  composerInput,
  mode,
  currentProjectId,
  isStreaming,
  selectedProviderId,
  selectedModel,
  commands,
  resolveCommand,
  dispatchCommand,
  createSession,
  selectSession,
  fetchSessions,
  sendMessage,
  getWelcomeModelOverride,
  setSessionModelOverride,
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
          welcomeOverride.providerId,
          welcomeOverride.model
        );
        setSessionModelOverride('', '', '');
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
      await sendMessage(
        currentProjectId,
        intent.content,
        {
          providerId: selectedProviderId || undefined,
          model: selectedModel || undefined,
        },
        undefined,
        { imageBase64: intent.attachments.length ? intent.attachments : undefined }
      );
      return { type: 'submittedConversation' };
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
    selectedProviderId,
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
