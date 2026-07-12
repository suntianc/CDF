import type { ConversationRunStreamEnvelope, Message } from '@shared/types';
import type {
  ConversationRuntimeProjectionState,
  RuntimeMessageDraft,
} from './conversationRuntimeProjection';

export const CONVERSATION_BUSY = 'CONVERSATION_BUSY' as const;

export interface ConversationRuntimeRegistryError {
  message: string;
  messageParams?: Record<string, string | number>;
  retryablePersistence?: boolean;
}

export interface ConversationRuntimeRegistryEntry {
  conversationId: string;
  requestId: string;
  projection: ConversationRuntimeProjectionState;
  /** Durable/runtime-free baseline used when replaying a complete snapshot. */
  baseProjection: ConversationRuntimeProjectionState;
  active: boolean;
  streamSource: 'foreground' | 'envelope';
  lastSequence: number;
  minimumHydrationSequence: number;
  hydrationPending: boolean;
  reconciliation: 'none' | 'pending' | 'failed';
  persistenceMessage?: RuntimeMessageDraft;
  error: ConversationRuntimeRegistryError | null;
}

export interface ConversationRuntimeRegistryState {
  /** At most one active Agent Run owner per Conversation. */
  entries: Readonly<Record<string, ConversationRuntimeRegistryEntry>>;
  /** Terminal projections awaiting durable reconciliation, keyed by request identity. */
  terminalOverlays: Readonly<Record<string, Readonly<Record<string, ConversationRuntimeRegistryEntry>>>>;
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
      type: 'mergeHistory';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
      baseProjection: ConversationRuntimeProjectionState;
    }
  | {
      type: 'receiveEnvelope';
      envelope: ConversationRunStreamEnvelope;
      initialProjection: ConversationRuntimeProjectionState;
      projection: ConversationRuntimeProjectionState;
      error?: ConversationRuntimeRegistryError;
    }
  | {
      type: 'requestHydration';
      conversationId: string;
      requestId?: string;
    }
  | {
      type: 'hydrateSnapshot';
      conversationId: string;
      requestId: string;
      sequence: number;
      projection: ConversationRuntimeProjectionState;
      baseProjection: ConversationRuntimeProjectionState;
    }
  | {
      type: 'hydrateMissing';
      conversationId: string;
      requestId?: string;
    }
  | {
      type: 'historyRefreshSucceeded';
      conversationId: string;
      requestId: string;
    }
  | {
      type: 'historyRefreshFailed';
      conversationId: string;
      requestId: string;
      error: ConversationRuntimeRegistryError;
    }
  | {
      type: 'terminalFailed';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
      error: ConversationRuntimeRegistryError;
    }
  | {
      type: 'persistenceFailed';
      conversationId: string;
      requestId: string;
      projection: ConversationRuntimeProjectionState;
      message: RuntimeMessageDraft;
      error: ConversationRuntimeRegistryError;
    }
  | {
      type: 'persistenceSucceeded';
      conversationId: string;
      requestId: string;
    }
  | {
      type: 'retryPersistence';
      conversationId: string;
      requestId: string;
    }
  | {
      type: 'release';
      conversationId: string;
      requestId: string;
    }
  | {
      type: 'removeConversation';
      conversationId: string;
    }
  | { type: 'reset' };

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
    }
  | {
      type: 'hydrateRuntime';
      conversationId: string;
      requestId?: string;
    }
  | {
      type: 'refreshHistory';
      conversationId: string;
      requestId: string;
    }
  | {
      type: 'persistTerminal';
      conversationId: string;
      requestId: string;
      message: RuntimeMessageDraft;
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
  return { entries: {}, terminalOverlays: {} };
}

function success(
  state: ConversationRuntimeRegistryState,
  applied = false,
  effects: ConversationRuntimeRegistryEffect[] = [],
): ConversationRuntimeRegistryResult {
  return { ok: true, applied, state, effects };
}

function replaceEntry(
  state: ConversationRuntimeRegistryState,
  entry: ConversationRuntimeRegistryEntry,
  effects: ConversationRuntimeRegistryEffect[] = [],
): ConversationRuntimeRegistryResult {
  return success({
    ...state,
    entries: {
      ...state.entries,
      [entry.conversationId]: entry,
    },
  }, true, effects);
}

function storeTerminalOverlay(
  state: ConversationRuntimeRegistryState,
  entry: ConversationRuntimeRegistryEntry,
  effects: ConversationRuntimeRegistryEffect[] = [],
): ConversationRuntimeRegistryResult {
  const active = state.entries[entry.conversationId];
  const entries = active?.requestId === entry.requestId
    ? Object.fromEntries(
        Object.entries(state.entries).filter(([conversationId]) => conversationId !== entry.conversationId),
      )
    : state.entries;
  return success({
    entries,
    terminalOverlays: {
      ...state.terminalOverlays,
      [entry.conversationId]: {
        ...state.terminalOverlays[entry.conversationId],
        [entry.requestId]: entry,
      },
    },
  }, true, effects);
}

function removeRequest(
  state: ConversationRuntimeRegistryState,
  conversationId: string,
  requestId: string,
  effect?: ConversationRuntimeRegistryEffect,
): ConversationRuntimeRegistryResult {
  const active = state.entries[conversationId];
  if (active?.requestId === requestId) {
    const { [conversationId]: _removed, ...entries } = state.entries;
    return success({ ...state, entries }, true, effect ? [effect] : []);
  }

  const overlays = state.terminalOverlays[conversationId];
  if (!overlays?.[requestId]) return success(state);
  const { [requestId]: _removed, ...remainingOverlays } = overlays;
  const terminalOverlays = { ...state.terminalOverlays };
  if (Object.keys(remainingOverlays).length > 0) {
    terminalOverlays[conversationId] = remainingOverlays;
  } else {
    delete terminalOverlays[conversationId];
  }
  return success({ ...state, terminalOverlays }, true, effect ? [effect] : []);
}

export function getConversationRuntimeEntry(
  state: ConversationRuntimeRegistryState,
  conversationId: string,
): ConversationRuntimeRegistryEntry | undefined {
  const active = state.entries[conversationId];
  if (active) return active;
  const overlays = Object.values(state.terminalOverlays[conversationId] ?? {});
  return overlays.at(-1);
}

export function getConversationRuntimeRequest(
  state: ConversationRuntimeRegistryState,
  conversationId: string,
  requestId: string,
): ConversationRuntimeRegistryEntry | undefined {
  const active = state.entries[conversationId];
  return active?.requestId === requestId
    ? active
    : state.terminalOverlays[conversationId]?.[requestId];
}

export function getConversationRuntimeErrorEntry(
  state: ConversationRuntimeRegistryState,
  conversationId: string,
): ConversationRuntimeRegistryEntry | undefined {
  const active = state.entries[conversationId];
  if (active?.error) return active;
  return Object.values(state.terminalOverlays[conversationId] ?? {}).filter((entry) => entry.error).at(-1);
}

export function mergeConversationRuntimeMessages(
  persisted: Message[],
  projection: ConversationRuntimeProjectionState | undefined,
): Message[] {
  if (!projection) return persisted;
  const liveById = new Map(projection.messages.map((message) => [message.id, message]));
  const merged = persisted.map((message) => liveById.get(message.id) ?? message);
  const persistedIds = new Set(persisted.map((message) => message.id));
  return [...merged, ...projection.messages.filter((message) => !persistedIds.has(message.id))];
}

export function transitionConversationRuntimeRegistry(
  state: ConversationRuntimeRegistryState,
  action: ConversationRuntimeRegistryAction,
): ConversationRuntimeRegistryResult {
  if (action.type === 'reset') {
    if (Object.keys(state.entries).length === 0 && Object.keys(state.terminalOverlays).length === 0) {
      return success(state);
    }
    return success(createConversationRuntimeRegistryState(), true);
  }

  if (action.type === 'removeConversation') {
    const hasActive = Boolean(state.entries[action.conversationId]);
    const hasOverlays = Boolean(state.terminalOverlays[action.conversationId]);
    if (!hasActive && !hasOverlays) return success(state);
    const { [action.conversationId]: _active, ...entries } = state.entries;
    const { [action.conversationId]: _overlays, ...terminalOverlays } = state.terminalOverlays;
    return success({ entries, terminalOverlays }, true);
  }

  const conversationId = action.type === 'receiveEnvelope'
    ? action.envelope.sessionId
    : action.conversationId;
  const current = state.entries[conversationId];

  if (action.type === 'claim') {
    if (current) {
      if (current.requestId === action.requestId) return success(state);
      return { ok: false, code: CONVERSATION_BUSY, state, effects: [] };
    }

    return replaceEntry(state, {
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
      baseProjection: action.projection,
      active: true,
      streamSource: 'foreground',
      lastSequence: 0,
      minimumHydrationSequence: 0,
      hydrationPending: false,
      reconciliation: 'none',
      error: null,
    });
  }

  if (action.type === 'requestHydration') {
    if (action.requestId && (!current || current.requestId !== action.requestId)) return success(state);
    if (current?.streamSource === 'foreground' || current?.hydrationPending) return success(state);
    const effect: ConversationRuntimeRegistryEffect = {
      type: 'hydrateRuntime',
      conversationId: action.conversationId,
      ...(action.requestId ? { requestId: action.requestId } : {}),
    };
    if (!current) return success(state, true, [effect]);
    return replaceEntry(state, { ...current, hydrationPending: true }, [effect]);
  }

  if (action.type === 'receiveEnvelope') {
    const { envelope } = action;
    if (current && current.requestId !== envelope.requestId) return success(state);
    if (!current && state.terminalOverlays[conversationId]?.[envelope.requestId]) return success(state);

    const entry = current ?? {
      conversationId: envelope.sessionId,
      requestId: envelope.requestId,
      projection: action.initialProjection,
      baseProjection: action.initialProjection,
      active: true,
      streamSource: 'envelope' as const,
      lastSequence: 0,
      minimumHydrationSequence: 0,
      hydrationPending: false,
      reconciliation: 'none' as const,
      error: null,
    };

    if (envelope.sequence <= entry.lastSequence) return success(state);
    if (envelope.sequence !== entry.lastSequence + 1) {
      const minimumHydrationSequence = Math.max(entry.minimumHydrationSequence, envelope.sequence);
      if (entry.hydrationPending) {
        return minimumHydrationSequence === entry.minimumHydrationSequence
          ? success(state)
          : replaceEntry(state, { ...entry, minimumHydrationSequence });
      }
      return replaceEntry(state, {
        ...entry,
        hydrationPending: true,
        minimumHydrationSequence,
      }, [{
        type: 'hydrateRuntime',
        conversationId: envelope.sessionId,
        requestId: envelope.requestId,
      }]);
    }

    const terminal = envelope.event.type === 'message_done' || envelope.event.type === 'runtime_error';
    const next: ConversationRuntimeRegistryEntry = {
      ...entry,
      projection: action.projection,
      active: !terminal,
      lastSequence: envelope.sequence,
      minimumHydrationSequence: envelope.sequence,
      hydrationPending: false,
      reconciliation: terminal ? (envelope.event.type === 'message_done' ? 'pending' : 'failed') : 'none',
      error: action.error ?? (terminal ? entry.error : null),
    };
    const effects: ConversationRuntimeRegistryEffect[] = [{
      type: 'projectRuntime',
      conversationId: envelope.sessionId,
      requestId: envelope.requestId,
      projection: action.projection,
    }];
    if (envelope.event.type === 'message_done') {
      effects.push({
        type: 'refreshHistory',
        conversationId: envelope.sessionId,
        requestId: envelope.requestId,
      });
    }
    return terminal
      ? storeTerminalOverlay(state, next, effects)
      : replaceEntry(state, next, effects);
  }

  if (action.type === 'hydrateSnapshot') {
    if (current && current.requestId !== action.requestId) return success(state);
    if (!current && state.terminalOverlays[conversationId]?.[action.requestId]) return success(state);
    if (current && action.sequence < current.lastSequence) return success(state);
    if (current?.hydrationPending && action.sequence < current.minimumHydrationSequence) {
      return replaceEntry(state, current, [{
        type: 'hydrateRuntime',
        conversationId: action.conversationId,
        requestId: action.requestId,
      }]);
    }
    return replaceEntry(state, {
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
      baseProjection: action.baseProjection,
      active: true,
      streamSource: 'envelope',
      lastSequence: action.sequence,
      minimumHydrationSequence: action.sequence,
      hydrationPending: false,
      reconciliation: 'none',
      error: null,
    }, [{
      type: 'projectRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
    }]);
  }

  if (action.type === 'hydrateMissing') {
    if (!current || (action.requestId && current.requestId !== action.requestId)) return success(state);
    const projection = {
      ...current.projection,
      isStreaming: false,
      streamingMessageId: null,
      pendingApproval: null,
    };
    return storeTerminalOverlay(state, {
      ...current,
      projection,
      active: false,
      hydrationPending: false,
      reconciliation: 'pending',
    }, [
      {
        type: 'projectRuntime',
        conversationId: action.conversationId,
        requestId: current.requestId,
        projection,
      },
      {
        type: 'refreshHistory',
        conversationId: action.conversationId,
        requestId: current.requestId,
      },
    ]);
  }

  const request = action.type === 'update'
    || action.type === 'mergeHistory'
    || action.type === 'terminalFailed'
    || action.type === 'persistenceFailed'
    || action.type === 'persistenceSucceeded'
    || action.type === 'historyRefreshSucceeded'
    || action.type === 'historyRefreshFailed'
    || action.type === 'retryPersistence'
    || action.type === 'release'
    ? getConversationRuntimeRequest(state, conversationId, action.requestId)
    : undefined;
  if (!request) return success(state);

  if (action.type === 'update') {
    if (!current || current.requestId !== action.requestId) return success(state);
    return replaceEntry(state, { ...current, projection: action.projection }, [{
      type: 'projectRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
    }]);
  }

  if (action.type === 'mergeHistory') {
    const next = {
      ...request,
      projection: action.projection,
      baseProjection: action.baseProjection,
    };
    return current?.requestId === action.requestId
      ? replaceEntry(state, next, [{
          type: 'projectRuntime',
          conversationId: action.conversationId,
          requestId: action.requestId,
          projection: action.projection,
        }])
      : storeTerminalOverlay(state, next, [{
          type: 'projectRuntime',
          conversationId: action.conversationId,
          requestId: action.requestId,
          projection: action.projection,
        }]);
  }

  if (action.type === 'terminalFailed') {
    return storeTerminalOverlay(state, {
      ...request,
      projection: action.projection,
      active: false,
      hydrationPending: false,
      reconciliation: 'failed',
      error: action.error,
    }, [{
      type: 'projectRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
    }]);
  }

  if (action.type === 'persistenceFailed') {
    return storeTerminalOverlay(state, {
      ...request,
      projection: action.projection,
      active: false,
      hydrationPending: false,
      reconciliation: 'failed',
      persistenceMessage: action.message,
      error: { ...action.error, retryablePersistence: true },
    }, [{
      type: 'projectRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
      projection: action.projection,
    }]);
  }

  if (action.type === 'persistenceSucceeded' || action.type === 'historyRefreshSucceeded') {
    return removeRequest(state, action.conversationId, action.requestId, {
      type: 'releaseRuntime',
      conversationId: action.conversationId,
      requestId: action.requestId,
    });
  }

  if (action.type === 'historyRefreshFailed') {
    return storeTerminalOverlay(state, {
      ...request,
      active: false,
      reconciliation: 'failed',
      error: action.error,
    });
  }

  if (action.type === 'retryPersistence') {
    if (request.reconciliation !== 'failed' || !request.persistenceMessage) return success(state);
    return storeTerminalOverlay(state, {
      ...request,
      reconciliation: 'pending',
      error: null,
    }, [{
      type: 'persistTerminal',
      conversationId: action.conversationId,
      requestId: action.requestId,
      message: request.persistenceMessage,
    }]);
  }

  if (!current || current.requestId !== action.requestId) return success(state);
  return removeRequest(state, action.conversationId, action.requestId, {
    type: 'releaseRuntime',
    conversationId: action.conversationId,
    requestId: action.requestId,
  });
}
