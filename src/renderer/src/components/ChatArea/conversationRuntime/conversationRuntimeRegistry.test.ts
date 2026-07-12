import { describe, expect, it } from 'vitest';
import { createConversationRuntimeState } from './conversationRuntimeProjection';
import {
  createConversationRuntimeRegistryState,
  mergeConversationRuntimeMessages,
  transitionConversationRuntimeRegistry,
} from './conversationRuntimeRegistry';

function runtime(conversationId: string, requestId: string) {
  return createConversationRuntimeState({
    sessionId: conversationId,
    requestId,
    streamingMessageId: requestId,
    currentAssistantMsgId: requestId,
  });
}

describe('Conversation Runtime Registry', () => {
  it('rejects a second Agent Run for the same Conversation with a stable busy code', () => {
    const initial = createConversationRuntimeRegistryState();
    const first = transitionConversationRuntimeRegistry(initial, {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection: runtime('conversation-1', 'request-1'),
    });
    expect(first.ok).toBe(true);

    const second = transitionConversationRuntimeRegistry(first.state, {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-2',
      projection: runtime('conversation-1', 'request-2'),
    });

    expect(second).toMatchObject({
      ok: false,
      code: 'CONVERSATION_BUSY',
      state: first.state,
      effects: [],
    });
    expect(second.state.entries['conversation-1']?.requestId).toBe('request-1');
  });

  it('allows different Conversations to own Agent Runs concurrently', () => {
    const first = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection: runtime('conversation-1', 'request-1'),
    });
    const second = transitionConversationRuntimeRegistry(first.state, {
      type: 'claim',
      conversationId: 'conversation-2',
      requestId: 'request-2',
      projection: runtime('conversation-2', 'request-2'),
    });

    expect(second.ok).toBe(true);
    expect(Object.keys(second.state.entries)).toEqual(['conversation-1', 'conversation-2']);
  });

  it('ignores updates and releases from a stale request identity', () => {
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-new',
      projection: runtime('conversation-1', 'request-new'),
    });
    const staleProjection = {
      ...runtime('conversation-1', 'request-old'),
      accumulatedContent: 'stale update',
    };

    const updated = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'update',
      conversationId: 'conversation-1',
      requestId: 'request-old',
      projection: staleProjection,
    });
    const released = transitionConversationRuntimeRegistry(updated.state, {
      type: 'release',
      conversationId: 'conversation-1',
      requestId: 'request-old',
    });

    expect(updated).toMatchObject({ ok: true, applied: false, effects: [] });
    expect(released).toMatchObject({ ok: true, applied: false, effects: [] });
    expect(released.state).toBe(claimed.state);
    expect(released.state.entries['conversation-1']?.requestId).toBe('request-new');
  });

  it('keeps ownership while the Agent Run is waiting for approval', () => {
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection: runtime('conversation-1', 'request-1'),
    });
    const approvalProjection = {
      ...runtime('conversation-1', 'request-1'),
      pendingApproval: {
        id: 'approval-1',
        runId: 'run-1',
        actions: [{ name: 'write_file', args: { path: 'README.md' } }],
      },
    };

    const waiting = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'update',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection: approvalProjection,
    });
    const duplicate = transitionConversationRuntimeRegistry(waiting.state, {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-2',
      projection: runtime('conversation-1', 'request-2'),
    });

    expect(waiting).toMatchObject({
      ok: true,
      applied: true,
      effects: [{ type: 'projectRuntime', conversationId: 'conversation-1', requestId: 'request-1' }],
    });
    expect(waiting.state.entries['conversation-1']?.projection.pendingApproval?.id).toBe('approval-1');
    expect(duplicate).toMatchObject({ ok: false, code: 'CONVERSATION_BUSY' });
  });

  it('ignores duplicate and stale envelopes and hydrates instead of applying a sequence gap', () => {
    const initial = runtime('conversation-1', 'request-1');
    const firstProjection = { ...initial, accumulatedContent: 'one' };
    const first = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'receiveEnvelope',
      envelope: {
        sessionId: 'conversation-1',
        requestId: 'request-1',
        messageId: 'request-1',
        origin: 'background-capability-continuation',
        sequence: 1,
        event: { type: 'message_chunk', text: 'one' },
      },
      initialProjection: initial,
      projection: firstProjection,
    });

    for (const sequence of [1, 0]) {
      const ignored = transitionConversationRuntimeRegistry(first.state, {
        type: 'receiveEnvelope',
        envelope: {
          sessionId: 'conversation-1',
          requestId: 'request-1',
          messageId: 'request-1',
          origin: 'background-capability-continuation',
          sequence,
          event: { type: 'message_chunk', text: 'ignored' },
        },
        initialProjection: initial,
        projection: { ...firstProjection, accumulatedContent: 'ignored' },
      });
      expect(ignored).toMatchObject({ applied: false, effects: [] });
      expect(ignored.state).toBe(first.state);
    }

    const gap = transitionConversationRuntimeRegistry(first.state, {
      type: 'receiveEnvelope',
      envelope: {
        sessionId: 'conversation-1',
        requestId: 'request-1',
        messageId: 'request-1',
        origin: 'background-capability-continuation',
        sequence: 3,
        event: { type: 'message_chunk', text: 'three' },
      },
      initialProjection: initial,
      projection: { ...firstProjection, accumulatedContent: 'one-three' },
    });

    expect(gap.state.entries['conversation-1']).toMatchObject({
      lastSequence: 1,
      hydrationPending: true,
      projection: { accumulatedContent: 'one' },
    });
    expect(gap.effects).toEqual([{
      type: 'hydrateRuntime',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    }]);
  });

  it('accepts only a current and sufficiently new hydration snapshot', () => {
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-new',
      projection: runtime('conversation-1', 'request-new'),
    });
    const current = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'hydrateSnapshot',
      conversationId: 'conversation-1',
      requestId: 'request-new',
      sequence: 4,
      projection: { ...runtime('conversation-1', 'request-new'), accumulatedContent: 'new' },
      baseProjection: runtime('conversation-1', 'request-new'),
    });
    const staleSequence = transitionConversationRuntimeRegistry(current.state, {
      type: 'hydrateSnapshot',
      conversationId: 'conversation-1',
      requestId: 'request-new',
      sequence: 3,
      projection: { ...runtime('conversation-1', 'request-new'), accumulatedContent: 'old' },
      baseProjection: runtime('conversation-1', 'request-new'),
    });
    const staleRequest = transitionConversationRuntimeRegistry(current.state, {
      type: 'hydrateSnapshot',
      conversationId: 'conversation-1',
      requestId: 'request-old',
      sequence: 8,
      projection: { ...runtime('conversation-1', 'request-old'), accumulatedContent: 'wrong request' },
      baseProjection: runtime('conversation-1', 'request-old'),
    });

    expect(staleSequence.state).toBe(current.state);
    expect(staleRequest.state).toBe(current.state);
    expect(current.state.entries['conversation-1']).toMatchObject({
      requestId: 'request-new',
      lastSequence: 4,
      hydrationPending: false,
      projection: { accumulatedContent: 'new' },
    });
  });

  it('turns null hydration into a terminal overlay and requests durable history', () => {
    const projection = { ...runtime('conversation-1', 'request-1'), accumulatedContent: 'visible' };
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection,
    });
    const missing = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'hydrateMissing',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });

    expect(missing.state.entries['conversation-1']).toMatchObject({
      active: false,
      reconciliation: 'pending',
      projection: { accumulatedContent: 'visible', isStreaming: false },
    });
    expect(missing.effects).toContainEqual({
      type: 'refreshHistory',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });
  });

  it('releases ownership but retains a retryable terminal overlay after persistence failure', () => {
    const projection = { ...runtime('conversation-1', 'request-1'), isStreaming: false };
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection,
    });
    const failed = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'persistenceFailed',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection,
      message: {
        id: 'request-1',
        session_id: 'conversation-1',
        role: 'assistant',
        content: 'terminal answer',
        tokens: 2,
      },
      error: { message: 'chat.persistenceFailed' },
    });

    expect(failed.state.entries['conversation-1']).toMatchObject({
      active: false,
      reconciliation: 'failed',
      error: { message: 'chat.persistenceFailed', retryablePersistence: true },
    });
    const nextRun = transitionConversationRuntimeRegistry(failed.state, {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-2',
      projection: runtime('conversation-1', 'request-2'),
    });
    expect(nextRun.ok).toBe(true);

    const staleSuccess = transitionConversationRuntimeRegistry(nextRun.state, {
      type: 'persistenceSucceeded',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });
    expect(staleSuccess.state).toBe(nextRun.state);
    expect(staleSuccess.state.entries['conversation-1']?.requestId).toBe('request-2');
  });

  it('translates persistence retry and successful reconciliation into effects', () => {
    const projection = { ...runtime('conversation-1', 'request-1'), isStreaming: false };
    const claimed = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection,
    });
    const failed = transitionConversationRuntimeRegistry(claimed.state, {
      type: 'persistenceFailed',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      projection,
      message: { id: 'request-1', session_id: 'conversation-1', role: 'assistant', content: 'done', tokens: 1 },
      error: { message: 'save failed' },
    });
    const retry = transitionConversationRuntimeRegistry(failed.state, {
      type: 'retryPersistence',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });

    expect(retry.effects).toEqual([expect.objectContaining({
      type: 'persistTerminal',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    })]);
    const reconciled = transitionConversationRuntimeRegistry(retry.state, {
      type: 'persistenceSucceeded',
      conversationId: 'conversation-1',
      requestId: 'request-1',
    });
    expect(reconciled.state.entries['conversation-1']).toBeUndefined();
  });

  it('lets live messages replace persisted messages with the same id', () => {
    const persisted = [{
      id: 'assistant-1',
      session_id: 'conversation-1',
      role: 'assistant' as const,
      content: 'old',
      tokens: 1,
      created_at: 1,
    }];
    const projection = {
      ...runtime('conversation-1', 'request-1'),
      messages: [{ ...persisted[0], content: 'new live content' }],
    };

    expect(mergeConversationRuntimeMessages(persisted, projection)).toEqual([
      expect.objectContaining({ id: 'assistant-1', content: 'new live content' }),
    ]);
  });

  it('removes one Conversation idempotently without changing another', () => {
    const first = transitionConversationRuntimeRegistry(createConversationRuntimeRegistryState(), {
      type: 'claim', conversationId: 'conversation-1', requestId: 'request-1', projection: runtime('conversation-1', 'request-1'),
    });
    const second = transitionConversationRuntimeRegistry(first.state, {
      type: 'claim', conversationId: 'conversation-2', requestId: 'request-2', projection: runtime('conversation-2', 'request-2'),
    });
    const removed = transitionConversationRuntimeRegistry(second.state, {
      type: 'removeConversation', conversationId: 'conversation-1',
    });
    const repeated = transitionConversationRuntimeRegistry(removed.state, {
      type: 'removeConversation', conversationId: 'conversation-1',
    });

    expect(removed.state.entries['conversation-1']).toBeUndefined();
    expect(removed.state.entries['conversation-2']?.requestId).toBe('request-2');
    expect(repeated).toMatchObject({ applied: false, effects: [] });
    expect(repeated.state).toBe(removed.state);
  });
});
