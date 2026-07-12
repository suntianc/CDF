import type { ConversationRuntimeProjectionState } from './conversationRuntimeProjection';

export const CONVERSATION_BUSY = 'CONVERSATION_BUSY' as const;

export interface ConversationRuntimeRegistryEntry {
  conversationId: string;
  requestId: string;
  projection: ConversationRuntimeProjectionState;
}

export interface ConversationRuntimeRegistryState {
  entries: Readonly<Record<string, ConversationRuntimeRegistryEntry>>;
}

export type ConversationRuntimeRegistryAction =
  | {
      type: 'claim';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
    }
  | {
      type: 'update';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
    }
  | {
      type: 'release';
      conversationId: string;
      requestId: string;
    };

export type ConversationRuntimeRegistryEffect =
  | {
      type: 'projectRuntime';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
    }
  | {
      type: 'releaseRuntime';
      conversationId: string;
      requestId: string;
    };

export type ConversationRuntimeRegistryResult =
  | {
      ok: true;
      applied: boolean;
      state: ConversationRuntimeRegistryState;
      effects: ConversationRuntimeRegistryEffect[];
    }
  | {
      ok: false;
      code: typeof CONVERSATION_BUSY;
      state: ConversationRuntimeRegistryState;
      effects: [];
    };

export function createConversationRuntimeRegistryState(): ConversationRuntimeRegistryState {
  return { entries: {} };
}

export function transitionConversationRuntimeRegistry(
  state: ConversationRuntimeRegistryState,
  action: ConversationRuntimeRegistryAction,
): ConversationRuntimeRegistryResult {
  const current = state.entries[action.conversationId];

  if (action.type === 'claim') {
    if (current) {
      if (current.requestId === action.requestId) {
        return { ok: true, applied: false, state, effects: [] };
      }
      return { ok: false, code: CONVERSATION_BUSY, state, effects: [] };
    }

    return {
      ok: true,
      applied: true,
      state: {
        entries: {
          ...state.entries,
          [action.conversationId]: {
            conversationId: action.conversationId,
            requestId: action.requestId,
            projection: action.projection,
          },
        },
      },
      effects: [],
    };
  }

  if (!current || current.requestId !== action.requestId) {
    return { ok: true, applied: false, state, effects: [] };
  }

  if (action.type === 'update') {
    return {
      ok: true,
      applied: true,
      state: {
        entries: {
          ...state.entries,
          [action.conversationId]: {
            ...current,
            projection: action.projection,
          },
        },
      },
      effects: [{
        type: 'projectRuntime',
        conversationId: action.conversationId,
        requestId: action.requestId,
        projection: action.projection,
      }],
    };
  }

  const { [action.conversationId]: _released, ...remainingEntries } = state.entries;
  return {
    ok: true,
    applied: true,
    state: { entries: remainingEntries },
    effects: [{
      type: 'releaseRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
    }],
  };
}
