import type { CommandDispatchAction, CommandSource, SlashCommand } from '@shared/types';

export type ComposerInputMode = 'welcome' | 'session';

export interface ComposerInputState {
  text: string;
  attachments: string[];
  cursor: number;
  isComposing: boolean;
  justFinishedComposition: boolean;
  commandEntry: {
    isOpen: boolean;
    query: string;
  };
  pathMention: {
    isOpen: boolean;
    query: string;
    cursor: number;
    requestId: number;
    loading: boolean;
    candidates: string[];
    truncated: boolean;
  };
}

export type ComposerInputIntent =
  | {
      type: 'sendConversation';
      mode: ComposerInputMode;
      content: string;
      attachments: string[];
    }
  | {
      type: 'executeCommand';
      plan: CommandDispatchAction;
    }
  | { type: 'noop' };

export interface ComposerInputContext {
  mode: ComposerInputMode;
  isStreaming: boolean;
  commands: ReadonlyArray<SlashCommand>;
  resolveCommand: (
    input: string,
    commands: ReadonlyArray<SlashCommand>
  ) => CommandDispatchAction | null;
}

export interface ComposerInputTextChange {
  value: string;
  cursor: number;
  hasProject: boolean;
}

export interface ComposerAttachmentInput {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export type ComposerInputLeadingItem =
  | {
      type: 'commandEntry';
      name: string;
      raw: string;
      source: CommandSource;
    }
  | {
      type: 'pathMention';
      name: string;
      raw: string;
      kind: 'file' | 'dir';
    };

export interface ComposerInputRenderModel {
  leadingItems: ComposerInputLeadingItem[];
  visibleTail: string;
}

export function createComposerInputState(
  initial: Partial<Pick<ComposerInputState, 'text' | 'attachments' | 'cursor'>> = {}
): ComposerInputState {
  return {
    text: initial.text ?? '',
    attachments: initial.attachments ?? [],
    cursor: initial.cursor ?? 0,
    isComposing: false,
    justFinishedComposition: false,
    commandEntry: {
      isOpen: false,
      query: '',
    },
    pathMention: {
      isOpen: false,
      query: '',
      cursor: 0,
      requestId: 0,
      loading: false,
      candidates: [],
      truncated: false,
    },
  };
}

export function startComposition(state: ComposerInputState): ComposerInputState {
  return {
    ...state,
    isComposing: true,
    justFinishedComposition: false,
  };
}

export function finishComposition(state: ComposerInputState): ComposerInputState {
  return {
    ...state,
    isComposing: false,
    justFinishedComposition: true,
  };
}

export function addComposerAttachment(
  state: ComposerInputState,
  attachment: ComposerAttachmentInput
): { state: ComposerInputState; accepted: boolean; reason?: 'tooMany' | 'tooLarge' | 'unsupportedType' } {
  const safeImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (state.attachments.length >= 5) {
    return { state, accepted: false, reason: 'tooMany' };
  }
  if (!safeImageTypes.has(attachment.mimeType)) {
    return { state, accepted: false, reason: 'unsupportedType' };
  }
  if (attachment.sizeBytes > 5 * 1024 * 1024) {
    return { state, accepted: false, reason: 'tooLarge' };
  }
  return {
    state: {
      ...state,
      attachments: [...state.attachments, attachment.dataUrl],
    },
    accepted: true,
  };
}

export function removeComposerAttachment(
  state: ComposerInputState,
  index: number
): ComposerInputState {
  return {
    ...state,
    attachments: state.attachments.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function updateComposerInputText(
  state: ComposerInputState,
  change: ComposerInputTextChange
): ComposerInputState {
  const textBeforeCursor = change.value.slice(0, change.cursor);
  const atMatch = textBeforeCursor.match(/(?:^|\s)@(\S*)$/);
  const commandEntryOpen =
    change.value.startsWith('/') &&
    !change.value.includes(' ') &&
    change.value.length <= 32;

  const closingPathMention = state.pathMention.isOpen && !(change.hasProject && atMatch);

  return {
    ...state,
    text: change.value,
    cursor: change.cursor,
    commandEntry: {
      isOpen: commandEntryOpen,
      query: commandEntryOpen ? change.value.slice(1) : '',
    },
    pathMention:
      change.hasProject && atMatch
        ? {
            isOpen: true,
            query: atMatch[1],
            cursor: change.cursor,
            requestId: state.pathMention.requestId,
            loading: state.pathMention.loading,
            candidates: state.pathMention.candidates,
            truncated: state.pathMention.truncated,
          }
        : {
            isOpen: false,
            query: '',
            cursor: 0,
            requestId: closingPathMention
              ? state.pathMention.requestId + 1
              : state.pathMention.requestId,
            loading: false,
            candidates: [],
            truncated: false,
          },
  };
}

export function startPathMentionCandidateRequest(
  state: ComposerInputState
): { state: ComposerInputState; requestId: number } {
  const requestId = state.pathMention.requestId + 1;
  return {
    requestId,
    state: {
      ...state,
      pathMention: {
        ...state.pathMention,
        requestId,
        loading: true,
        candidates: [],
        truncated: false,
      },
    },
  };
}

export function resolvePathMentionCandidateRequest(
  state: ComposerInputState,
  requestId: number,
  result: { candidates: string[]; truncated: boolean }
): ComposerInputState {
  if (requestId !== state.pathMention.requestId) return state;
  return {
    ...state,
    pathMention: {
      ...state.pathMention,
      loading: false,
      candidates: result.candidates,
      truncated: result.truncated,
    },
  };
}

export function closePathMentionCandidates(state: ComposerInputState): ComposerInputState {
  return {
    ...state,
    pathMention: {
      ...state.pathMention,
      isOpen: false,
      query: '',
      cursor: 0,
      requestId: state.pathMention.requestId + 1,
      loading: false,
      candidates: [],
      truncated: false,
    },
  };
}

export function insertCommandEntry(
  state: ComposerInputState,
  commandText: string
): ComposerInputState {
  const text = `${commandText} `;
  return {
    ...state,
    text,
    cursor: text.length,
    commandEntry: {
      isOpen: false,
      query: '',
    },
  };
}

export function selectPathMentionCandidate(
  state: ComposerInputState,
  path: string
): ComposerInputState {
  const cursor = state.pathMention.cursor;
  const textBeforeCursor = state.text.slice(0, cursor);
  const atCharIndex = textBeforeCursor.lastIndexOf('@');
  if (atCharIndex < 0) return state;

  const text = `${state.text.slice(0, atCharIndex)}@${path} ${state.text.slice(cursor)}`;
  return {
    ...state,
    text,
    cursor: atCharIndex + path.length + 2,
    pathMention: {
      isOpen: false,
      query: '',
      cursor: 0,
      requestId: state.pathMention.requestId + 1,
      loading: false,
      candidates: [],
      truncated: false,
    },
  };
}

export function getComposerInputRenderModel(
  state: ComposerInputState,
  commands: ReadonlyArray<SlashCommand>
): ComposerInputRenderModel {
  const leadingItems: ComposerInputLeadingItem[] = [];
  let remaining = state.text;

  if (remaining.startsWith('/')) {
    const match = remaining.match(/^\/([\w-]+)(?=\s)/);
    if (match) {
      const command = commands.find((candidate) => candidate.name === match[1]);
      if (command) {
        leadingItems.push({
          type: 'commandEntry',
          name: command.name,
          raw: `/${command.name}`,
          source: command.source,
        });
        remaining = remaining.slice(command.name.length + 1);
        if (remaining.startsWith(' ')) {
          remaining = remaining.slice(1);
        }
      }
    }
  }

  while (true) {
    const match = remaining.match(/^@([\w./-]+)(?=\s)/);
    if (!match) break;
    const path = match[1];
    leadingItems.push({
      type: 'pathMention',
      name: path,
      raw: `@${path}`,
      kind: path.endsWith('/') ? 'dir' : 'file',
    });
    remaining = remaining.slice(path.length + 1);
    if (remaining.startsWith(' ')) {
      remaining = remaining.slice(1);
    }
  }

  return {
    leadingItems,
    visibleTail: remaining,
  };
}

export function deletePreviousLeadingItem(
  state: ComposerInputState,
  commands: ReadonlyArray<SlashCommand>
): ComposerInputState {
  const renderModel = getComposerInputRenderModel(state, commands);
  if (renderModel.leadingItems.length === 0) return state;

  const remainingItems = renderModel.leadingItems.slice(0, -1);
  const prefix = remainingItems.map((item) => item.raw).join(' ');
  const text = [prefix, renderModel.visibleTail].filter(Boolean).join(' ');

  return {
    ...state,
    text,
    cursor: prefix ? prefix.length + 1 : 0,
    commandEntry: {
      isOpen: false,
      query: '',
    },
    pathMention: {
      isOpen: false,
      query: '',
      cursor: 0,
      requestId: state.pathMention.requestId + 1,
      loading: false,
      candidates: [],
      truncated: false,
    },
  };
}

export function submitComposerInput(
  state: ComposerInputState,
  context: ComposerInputContext
): { state: ComposerInputState; intent: ComposerInputIntent } {
  if (state.isComposing || state.justFinishedComposition) {
    return {
      state: {
        ...state,
        justFinishedComposition: false,
      },
      intent: { type: 'noop' },
    };
  }

  if (context.isStreaming) {
    return { state, intent: { type: 'noop' } };
  }

  const content = state.text.trim();
  if (!content && state.attachments.length === 0) {
    return { state, intent: { type: 'noop' } };
  }

  if (state.text.startsWith('/')) {
    const plan = context.resolveCommand(state.text, context.commands);
    if (plan) {
      return {
        state: createComposerInputState(),
        intent: {
          type: 'executeCommand',
          plan,
        },
      };
    }
  }

  return {
    state: createComposerInputState(),
    intent: {
      type: 'sendConversation',
      mode: context.mode,
      content: content || '请描述这张图片',
      attachments: state.attachments,
    },
  };
}
