import { describe, expect, it } from 'vitest';
import { createConversationRuntimeState } from './conversationRuntimeProjection';
import {
  createConversationRuntimeRegistryState,
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
});
