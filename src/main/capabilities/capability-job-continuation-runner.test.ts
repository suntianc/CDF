import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationRunStreamEnvelope } from '../../shared/types';
import { ConversationRunStreams } from '../conversation-run-streams';
import { createCapabilityJobContinuationRunner } from './capability-job-continuation-runner';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE capability_job_continuation_batches (
      batch_id TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    );
  `);
  return db;
}

const batch = {
  batchId: 'batch-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  eventIds: ['capability-job:job-1:terminal'],
  events: [{
    eventId: 'capability-job:job-1:terminal',
    jobId: 'job-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    status: 'completed' as const,
    provider: 'xai-oauth' as const,
    mode: 'text' as const,
    artifacts: [],
    error: null,
  }],
};

describe('capability Job continuation runner', () => {
  it('streams chunks immediately but publishes done only after durable output exists', async () => {
    const db = database();
    const emitted: ConversationRunStreamEnvelope[] = [];
    const streams = new ConversationRunStreams({
      emit: (envelope) => {
        if (envelope.event.type === 'message_done') {
          const message = db.prepare('SELECT content FROM messages WHERE id = ?')
            .get('background-continuation-output:batch-1');
          expect(message).toEqual({ content: '视频已经完成' });
        }
        emitted.push(envelope);
      },
    });
    const runChat = vi.fn(async (sender) => {
      sender.send('ignored', { type: 'message_chunk', text: '视频已经完成' });
      sender.send('ignored', { type: 'message_done' });
    });
    const onMessagesChanged = vi.fn();
    const runContinuation = createCapabilityJobContinuationRunner({
      db,
      streams,
      runChat,
      onMessagesChanged,
      now: () => 100,
    });

    await runContinuation(batch);

    expect(emitted.map(({ event }) => event)).toEqual([
      { type: 'message_chunk', text: '视频已经完成' },
      { type: 'message_done' },
    ]);
    expect(onMessagesChanged).toHaveBeenCalledWith('session-1');
    expect(db.prepare('SELECT batch_id FROM capability_job_continuation_batches').all())
      .toEqual([{ batch_id: 'batch-1' }]);
  });

  it('clears the active stream and leaves the batch retryable when the Agent run fails', async () => {
    const db = database();
    const streams = new ConversationRunStreams({ emit: vi.fn() });
    const runContinuation = createCapabilityJobContinuationRunner({
      db,
      streams,
      runChat: vi.fn(async () => {
        throw new Error('model unavailable');
      }),
      onMessagesChanged: vi.fn(),
    });

    await expect(runContinuation(batch)).rejects.toThrow('model unavailable');
    expect(streams.getActive('session-1')).toBeNull();
    expect(db.prepare('SELECT * FROM capability_job_continuation_batches').all()).toEqual([]);
  });
});
