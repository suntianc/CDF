import { useCallback, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { toast } from 'sonner';
import type { CommandDispatchAction, SlashCommand } from '@shared/types';
import {
  addComposerAttachment,
  clearFinishedComposition as clearComposerFinishedComposition,
  closePathMentionCandidates,
  createComposerInputState,
  deletePreviousLeadingItem,
  finishComposition as finishComposerComposition,
  getComposerInputRenderModel,
  insertCommandEntry,
  removeComposerAttachment,
  resolvePathMentionCandidateRequest,
  selectPathMentionCandidate,
  startComposition as startComposerComposition,
  startPathMentionCandidateRequest,
  submitComposerInput,
  updateComposerInputText,
  type ComposerInputMode,
  type ComposerInputState,
  type ComposerAttachmentInput,
} from './composerInput';

export type PathMentionCandidateLoader = (
  projectId: string
) => Promise<{ candidates: string[]; truncated: boolean }>;

export interface UseComposerInputControllerOptions {
  mode: ComposerInputMode;
  isStreaming: boolean;
  projectId: string | null;
  hasPathMentionProject: boolean;
  commands: ReadonlyArray<SlashCommand>;
  resolveCommand: (
    input: string,
    commands: ReadonlyArray<SlashCommand>
  ) => CommandDispatchAction | null;
  listPathMentionCandidates?: PathMentionCandidateLoader;
  notifyWarning?: (message: string) => void;
}

const defaultListPathMentionCandidates: PathMentionCandidateLoader = (projectId) =>
  window.electronAPI.project.listAtMentionCandidates(projectId);

export function useComposerInputController({
  mode,
  isStreaming,
  projectId,
  hasPathMentionProject,
  commands,
  resolveCommand,
  listPathMentionCandidates = defaultListPathMentionCandidates,
  notifyWarning = toast.warning,
}: UseComposerInputControllerOptions) {
  const [state, setState] = useState<ComposerInputState>(() => createComposerInputState());
  const stateRef = useRef(state);

  const updateState = useCallback((next: ComposerInputState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const closePathMention = useCallback(() => {
    updateState(closePathMentionCandidates(stateRef.current));
  }, [updateState]);

  const reset = useCallback(() => {
    updateState(createComposerInputState());
  }, [updateState]);

  const closeCommandEntry = useCallback(() => {
    updateState({
      ...stateRef.current,
      commandEntry: {
        isOpen: false,
        query: '',
      },
    });
  }, [updateState]);

  const startComposition = useCallback(() => {
    updateState(startComposerComposition(stateRef.current));
  }, [updateState]);

  const finishComposition = useCallback(() => {
    updateState(finishComposerComposition(stateRef.current));
  }, [updateState]);

  const clearFinishedComposition = useCallback(() => {
    updateState(clearComposerFinishedComposition(stateRef.current));
  }, [updateState]);

  const setText = useCallback(
    (text: string, cursor = text.length) => {
      updateState({
        ...stateRef.current,
        text,
        cursor,
      });
    },
    [updateState]
  );

  const loadPathMentionCandidates = useCallback(
    (input: ComposerInputState) => {
      if (!projectId) {
        updateState(closePathMentionCandidates(input));
        return;
      }

      const request = startPathMentionCandidateRequest(input);
      updateState(request.state);

      listPathMentionCandidates(projectId)
        .then((result) => {
          updateState(
            resolvePathMentionCandidateRequest(stateRef.current, request.requestId, result)
          );
        })
        .catch(() => {
          updateState(
            resolvePathMentionCandidateRequest(stateRef.current, request.requestId, {
              candidates: [],
              truncated: false,
            })
          );
        });
    },
    [listPathMentionCandidates, projectId, updateState]
  );

  const handleTextChange = useCallback(
    (value: string, cursor: number) => {
      const next = updateComposerInputText(stateRef.current, {
        value,
        cursor,
        hasProject: hasPathMentionProject,
      });

      if (next.pathMention.isOpen && !stateRef.current.pathMention.isOpen) {
        loadPathMentionCandidates(next);
        return;
      }

      updateState(next);
    },
    [hasPathMentionProject, loadPathMentionCandidates, updateState]
  );

  const selectPathMention = useCallback(
    (path: string) => {
      updateState(selectPathMentionCandidate(stateRef.current, path));
    },
    [updateState]
  );

  const insertCommand = useCallback(
    (commandText: string) => {
      updateState(insertCommandEntry(stateRef.current, commandText));
    },
    [updateState]
  );

  const removeAttachment = useCallback(
    (index: number) => {
      updateState(removeComposerAttachment(stateRef.current, index));
    },
    [updateState]
  );

  const addAttachment = useCallback(
    (attachment: ComposerAttachmentInput) => {
      const result = addComposerAttachment(stateRef.current, attachment);
      updateState(result.state);
      return result;
    },
    [updateState]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const safeImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
      const items = Array.from(event.clipboardData.items);
      const imageItems = items.filter((item) => safeImageTypes.has(item.type));
      if (imageItems.length === 0) return;

      event.preventDefault();
      imageItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (readerEvent) => {
          const dataUrl = readerEvent.target?.result;
          if (typeof dataUrl !== 'string') return;

          const result = addAttachment({
            dataUrl,
            mimeType: file.type,
            sizeBytes: file.size,
          });
          if (result.accepted) return;

          if (result.reason === 'tooMany') {
            notifyWarning('最多添加 5 张图片');
          } else if (result.reason === 'tooLarge') {
            notifyWarning(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大 5MB`);
          } else if (result.reason === 'unsupportedType') {
            notifyWarning('不支持的图片类型');
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [addAttachment, notifyWarning]
  );

  const deletePreviousLeading = useCallback(
    (tail: string) => {
      const renderModel = getComposerInputRenderModel(stateRef.current, commands);
      const prefix = renderModel.leadingItems.map((token) => token.raw).join(' ');
      const text = `${prefix}${renderModel.leadingItems.length > 0 ? ' ' : ''}${
        tail.startsWith(' ') ? tail.slice(1) : tail
      }`;
      updateState(
        deletePreviousLeadingItem(
          {
            ...stateRef.current,
            text,
            cursor: 0,
          },
          commands
        )
      );
    },
    [commands, updateState]
  );

  const submit = useCallback(() => {
    const result = submitComposerInput(stateRef.current, {
      mode,
      isStreaming,
      commands,
      resolveCommand,
    });
    updateState(result.state);
    return result.intent;
  }, [commands, isStreaming, mode, resolveCommand, updateState]);

  const renderModel = useMemo(
    () => getComposerInputRenderModel(state, commands),
    [commands, state]
  );

  return {
    state,
    text: state.text,
    attachments: state.attachments,
    commandEntry: state.commandEntry,
    pathMention: state.pathMention,
    renderModel,
    reset,
    setText,
    handleTextChange,
    startComposition,
    finishComposition,
    clearFinishedComposition,
    closePathMention,
    closeCommandEntry,
    selectPathMention,
    insertCommand,
    addAttachment,
    removeAttachment,
    handlePaste,
    deletePreviousLeading,
    submit,
  };
}

export type ComposerInputController = ReturnType<typeof useComposerInputController>;
