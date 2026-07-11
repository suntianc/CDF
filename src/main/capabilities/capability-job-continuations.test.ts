import Database from 'better-sqlite3';
import { EventEmitter, once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityJobSnapshot } from '../../shared/capability-jobs';
import {
  CapabilityJobContinuationCoordinator,
  initializeCapabilityJobContinuationSchema,
} from './capability-job-continuations';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_id TEXT);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE capability_jobs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_session_id TEXT,
      status TEXT NOT NULL, artifacts TEXT, error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO projects (id, path) VALUES ('project-1', '/project');
    INSERT INTO sessions (id, project_id, agent_id) VALUES
      ('session-1', 'project-1', 'agent-1'),
      ('session-2', 'project-1', 'agent-2');
  `);
  initializeCapabilityJobContinuationSchema(db);
  return db;
}

function job(id: string, sessionId = 'session-1'): CapabilityJobSnapshot {
  return {
    id,
    sourceSessionId: sessionId,
    projectId: 'project-1',
    type: 'video.generate',
    status: 'completed',
    provider: 'xai-oauth',
    connectionId: 'xai-oauth',
    queuePosition: null,
    relatedJobId: null,
    availableActions: [],
    artifacts: [{ path: `/project/${id}.mp4`, mimeType: 'video/mp4' }],
    error: null,
    statusMessage: 'artifact_durable',
    createdAt: 1,
    updatedAt: 2,
    continuationStatus: null,
    continuationError: null,
  };
}

function scheduler() {
  const tasks: Array<() => void> = [];
  return {
    schedule: (task: () => void) => tasks.push(task),
    async runNext(coordinator: CapabilityJobContinuationCoordinator) {
      const task = tasks.shift();
      if (!task) throw new Error('No continuation task scheduled');
      task();
      await coordinator.waitForIdle();
    },
    startNext() {
      const task = tasks.shift();
      if (!task) throw new Error('No continuation task scheduled');
      task();
    },
    count: () => tasks.length,
  };
}

describe('CapabilityJobContinuationCoordinator', () => {
  it('persists one stable terminal event and one significant Timeline message', () => {
    const db = database();
    const queue = scheduler();
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation: vi.fn(),
      schedule: queue.schedule,
    });

    coordinator.enqueue(job('job-1'));
    coordinator.enqueue(job('job-1'));

    const events = db.prepare('SELECT * FROM capability_job_completion_events').all();
    const messages = db.prepare('SELECT content FROM messages').all() as Array<{ content: string }>;
    expect(events).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0].content)).toMatchObject({
      type: 'capability_job_event',

      eventId: 'capability-job:job-1:terminal',
      jobId: 'job-1',
    });
  });

  it('enforces one active Agent run per Conversation', () => {
    const db = database();
    db.prepare("INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'session-1', 'running')").run();

    expect(() => db.prepare(
      "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-2', 'session-1', 'running')"
    ).run()).toThrow();
  });

  it('keeps events pending while busy, then coalesces all pending events once idle', async () => {
    const db = database();
    const queue = scheduler();
    const runContinuation = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: queue.schedule,
    });
    db.prepare("INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'session-1', 'running')").run();
    coordinator.enqueue(job('job-1'));
    coordinator.enqueue(job('job-2'));

    await queue.runNext(coordinator);
    expect(runContinuation).not.toHaveBeenCalled();

    db.prepare("UPDATE agent_runs SET status = 'completed' WHERE id = 'run-1'").run();
    coordinator.notifyConversationIdle('session-1');
    await queue.runNext(coordinator);

    expect(runContinuation).toHaveBeenCalledTimes(1);
    expect(runContinuation).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      eventIds: ['capability-job:job-1:terminal', 'capability-job:job-2:terminal'],
    }));
    expect(coordinator.listProjectStates('project-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: 'job-1', status: 'consumed' }),
      expect.objectContaining({ jobId: 'job-2', status: 'consumed' }),
    ]));
  });

  it('leaves events arriving during a continuation for the next batch', async () => {
    const db = database();
    const queue = scheduler();
    const release = new EventEmitter();
    const batches: string[][] = [];
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation: vi.fn(async (batch) => {
        batches.push(batch.eventIds);
        await once(release, 'continue');
      }),
      schedule: queue.schedule,
    });
    coordinator.enqueue(job('job-1'));
    queue.startNext();
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    coordinator.enqueue(job('job-2'));
    release.emit('continue');
    await coordinator.waitForIdle();
    queue.startNext();
    release.emit('continue');
    await coordinator.waitForIdle();

    expect(batches).toEqual([
      ['capability-job:job-1:terminal'],
      ['capability-job:job-2:terminal'],
    ]);
  });

  it('isolates batches by Conversation even when another Conversation is active', async () => {
    const db = database();
    const queue = scheduler();
    const runContinuation = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: queue.schedule,
    });
    coordinator.enqueue(job('job-1', 'session-1'));
    coordinator.enqueue(job('job-2', 'session-2'));

    await queue.runNext(coordinator);
    await queue.runNext(coordinator);

    expect(runContinuation.mock.calls.map(([batch]) => ({
      sessionId: batch.sessionId,
      paths: batch.events.flatMap((event: { artifacts: Array<{ path: string }> }) => event.artifacts.map((artifact) => artifact.path)),
    }))).toEqual(expect.arrayContaining([
      { sessionId: 'session-1', paths: ['/project/job-1.mp4'] },
      { sessionId: 'session-2', paths: ['/project/job-2.mp4'] },
    ]));
  });

  it('recovers a terminal Job that was durable before its completion event', async () => {
    const db = database();
    const queue = scheduler();
    const runContinuation = vi.fn().mockResolvedValue(undefined);
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: queue.schedule,
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, source_session_id, status, artifacts, error, created_at, updated_at)
      VALUES ('job-recovered', 'project-1', 'session-1', 'completed', ?, NULL, 1, 2)`)
      .run(JSON.stringify([{ path: '/project/recovered.mp4', mimeType: 'video/mp4' }]));

    coordinator.resumePending();
    await queue.runNext(coordinator);

    expect(runContinuation).toHaveBeenCalledWith(expect.objectContaining({
      eventIds: ['capability-job:job-recovered:terminal'],
      events: [expect.objectContaining({
        jobId: 'job-recovered',
        artifacts: [{ path: '/project/recovered.mp4', mimeType: 'video/mp4' }],
      })],
    }));
    expect(coordinator.listProjectStates('project-1')).toEqual([
      expect.objectContaining({ jobId: 'job-recovered', status: 'consumed' }),
    ]);
  });

  it('treats a durable empty-output batch marker as consumed after restart', () => {
    const db = database();
    const initialQueue = scheduler();
    const initial = new CapabilityJobContinuationCoordinator(db, {
      runContinuation: vi.fn(),
      schedule: initialQueue.schedule,
    });
    initial.enqueue(job('job-crash-window'));
    db.prepare(`UPDATE capability_job_completion_events
      SET status = 'running', batch_id = 'batch-1', started_at = 2
      WHERE job_id = 'job-crash-window'`).run();
    db.prepare(`INSERT INTO capability_job_continuation_batches (batch_id, completed_at)
      VALUES ('batch-1', 3)`).run();
    const runContinuation = vi.fn();
    const recovered = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: vi.fn(),
    });

    recovered.resumePending();
    expect(runContinuation).not.toHaveBeenCalled();
    expect(recovered.listProjectStates('project-1')).toEqual([
      expect.objectContaining({ jobId: 'job-crash-window', status: 'consumed' }),
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE id = 'background-continuation-output:batch-1'`).get()).toEqual({ count: 0 });
  });

  it('does not leave completion events behind when their Conversation is deleted', () => {
    const db = database();
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation: vi.fn(),
      schedule: vi.fn(),
    });
    coordinator.enqueue(job('job-orphan'));

    db.prepare("DELETE FROM sessions WHERE id = 'session-1'").run();

    expect(db.prepare('SELECT COUNT(*) AS count FROM capability_job_completion_events').get())
      .toEqual({ count: 0 });
  });

  it('quarantines an invalid durable event instead of rejecting its runner Promise', async () => {
    const db = database();
    const queue = scheduler();
    const runContinuation = vi.fn();
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: queue.schedule,
    });
    coordinator.enqueue(job('job-invalid'));
    db.prepare(`UPDATE capability_job_completion_events
      SET payload = '{not-json' WHERE job_id = 'job-invalid'`).run();

    await queue.runNext(coordinator);

    expect(runContinuation).not.toHaveBeenCalled();
    expect(coordinator.listProjectStates('project-1')).toEqual([
      expect.objectContaining({
        jobId: 'job-invalid',
        status: 'failed',
        error: 'Invalid persisted completion event: payload',
      }),
    ]);
  });

  it('retries a failed continuation without duplicating or re-consuming events', async () => {
    const db = database();
    const queue = scheduler();
    const runContinuation = vi.fn()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation,
      schedule: queue.schedule,
    });
    coordinator.enqueue(job('job-1'));

    await queue.runNext(coordinator);
    expect(coordinator.listProjectStates('project-1')).toEqual([
      expect.objectContaining({ jobId: 'job-1', status: 'failed', attemptCount: 1 }),
    ]);
    await queue.runNext(coordinator);

    expect(runContinuation).toHaveBeenCalledTimes(2);
    expect(runContinuation.mock.calls[0]?.[0].batchId)
      .toBe(runContinuation.mock.calls[1]?.[0].batchId);
    expect(coordinator.listProjectStates('project-1')).toEqual([
      expect.objectContaining({ jobId: 'job-1', status: 'consumed', attemptCount: 2 }),
    ]);
    coordinator.notifyConversationIdle('session-1');
    await queue.runNext(coordinator);
    expect(runContinuation).toHaveBeenCalledTimes(2);
  });
});
