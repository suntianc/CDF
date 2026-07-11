import { describe, expect, it, vi } from 'vitest';
import { ConversationRunStreams } from './conversation-run-streams';

describe('ConversationRunStreams', () => {
  it('publishes live chunks and exposes a resumable snapshot before commit', () => {
    const emit = vi.fn();
    const streams = new ConversationRunStreams({ emit });
    const stream = streams.begin({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
    });

    stream.sender.send('ignored-channel', { type: 'message_chunk', text: '结果' });
    stream.sender.send('ignored-channel', { type: 'message_chunk', text: '已完成' });

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        messageId: 'background-continuation-output:batch-1',
        sequence: 1,
        event: { type: 'message_chunk', text: '结果' },
      }),
      expect.objectContaining({
        sequence: 2,
        event: { type: 'message_chunk', text: '已完成' },
      }),
    ]);
    expect(streams.getActive('session-1')).toEqual(expect.objectContaining({
      content: '结果已完成',
      sequence: 2,
    }));
  });

  it('publishes message_done only after the caller commits durable output', () => {
    const emit = vi.fn();
    const streams = new ConversationRunStreams({ emit });
    const stream = streams.begin({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
    });

    stream.sender.send('ignored-channel', { type: 'message_chunk', text: '完成' });
    stream.sender.send('ignored-channel', { type: 'message_done' });

    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({
      event: { type: 'message_done' },
    }));
    expect(streams.getActive('session-1')).not.toBeNull();

    stream.commit();

    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({
      sequence: 2,
      event: { type: 'message_done' },
    }));
    expect(streams.getActive('session-1')).toBeNull();
  });

  it('rejects a second active run for the same Conversation', () => {
    const streams = new ConversationRunStreams({ emit: vi.fn() });
    streams.begin({
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'message-1',
      origin: 'background-capability-continuation',
    });

    expect(() => streams.begin({
      sessionId: 'session-1',
      requestId: 'request-2',
      messageId: 'message-2',
      origin: 'background-capability-continuation',
    })).toThrow('Conversation session-1 already has an active streamed run');
  });
});
