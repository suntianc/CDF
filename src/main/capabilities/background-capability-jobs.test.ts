import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundCapabilityJobService,
  initializeCapabilityJobSchema,
} from './background-capability-jobs';

const tempDirs: string[] = [];

async function projectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdf-video-job-'));
  tempDirs.push(dir);
  return dir;
}

function database() {
  const db = new Database(':memory:');
  initializeCapabilityJobSchema(db);
  return db;
}

function scheduler() {
  const tasks: Array<() => void> = [];
  return {
    schedule: (task: () => void) => tasks.push(task),
    async runNext(service: BackgroundCapabilityJobService) {
      const task = tasks.shift();
      if (!task) throw new Error('No scheduled Job runner');
      task();
      await service.waitForIdle();
    },
    startNext() {
      const task = tasks.shift();
      if (!task) throw new Error('No scheduled Job runner');
      task();
    },
    async runCurrentConcurrently(service: BackgroundCapabilityJobService) {
      const current = tasks.splice(0);
      if (current.length === 0) throw new Error('No scheduled Job runners');
      for (const task of current) task();
      await service.waitForIdle();
    },
    count: () => tasks.length,
  };
}
describe('initializeCapabilityJobSchema', () => {
  it('adds connection columns before creating the queue index for an existing database', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE capability_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_task_id TEXT,
      artifacts TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);

    expect(() => initializeCapabilityJobSchema(db)).not.toThrow();
    const columns = db.prepare('PRAGMA table_info(capability_jobs)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('connection_id');
    const index = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_capability_jobs_connection_queue'"
    ).get();
    expect(index).toBeTruthy();
  });
});


afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('BackgroundCapabilityJobService safety lifecycle', () => {
  it('queues locally and submits at most one video per frozen connection', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-2' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/2' } })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('video'), mimeType: 'video/mp4' }),
      sleep: async () => undefined,
      schedule: queue.schedule,
    });

    const first = await service.submitVideo({ prompt: 'first', route_hint: 'auto' }, dir, 'session-1');
    const second = await service.submitVideo({ prompt: 'second', route_hint: 'xai-oauth' }, dir, 'session-1');
    if (!first.ok || !second.ok) throw new Error('submission failed');

    expect(fetch).not.toHaveBeenCalled();
    expect(service.list('project-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.jobId, status: 'queued', connectionId: 'xai-oauth', queuePosition: 1 }),
      expect.objectContaining({ id: second.jobId, status: 'queued', connectionId: 'xai-oauth', queuePosition: 2 }),
    ]));

    await queue.runCurrentConcurrently(service);
    expect(service.get('project-1', first.jobId)).toMatchObject({ status: 'completed' });
    expect(fetch).toHaveBeenCalledTimes(2);
    await queue.runNext(service);
    expect(service.get('project-1', second.jobId)).toMatchObject({ status: 'completed' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('marks an ambiguous creation failure unknown and only resubmits explicitly as a linked Job', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn().mockRejectedValue(new Error('connection reset'));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
    });

    const receipt = await service.submitVideo({ prompt: 'charged maybe' }, dir, 'session-1');
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: 'submission_unknown',
      availableActions: ['resubmit'],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    service.resumePending();
    await service.waitForIdle();
    expect(fetch).toHaveBeenCalledTimes(1);

    const resubmitted = service.resubmit('project-1', receipt.jobId);
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;
    expect(resubmitted.job).toMatchObject({ status: 'queued', relatedJobId: receipt.jobId });
    expect(service.get('project-1', receipt.jobId)).toMatchObject({ status: 'submission_unknown' });
  });

  it('times out a hung creation request without automatically resubmitting it', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn(async () => {
      await sleepTimer(25);
      return new Response(JSON.stringify({ request_id: 'too-late' }));
    });
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
      submissionTimeoutMs: 1,
    });
    const receipt = await service.submitVideo({ prompt: 'timeout safely' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({ status: 'submission_unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a server-side creation error without a task ID as submission_unknown', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn().mockResolvedValue(new Response('temporary provider failure', { status: 503 }));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
    });
    const receipt = await service.submitVideo({ prompt: 'ambiguous 503' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({ status: 'submission_unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels queued work without provider contact', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
    });
    const receipt = await service.submitVideo({ prompt: 'cancel me' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    expect(service.cancel('project-1', receipt.jobId)).toMatchObject({
      ok: true,
      job: expect.objectContaining({ status: 'canceled', availableActions: [] }),
    });
    await queue.runNext(service);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops and resumes tracking with the same Provider Task ID', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/recovered' } }))
    );
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: false, fetch }),
      download: async () => ({ bytes: Buffer.from('recovered'), mimeType: 'video/mp4' }),

      schedule: queue.schedule,
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, created_at, updated_at)
      VALUES ('job-1', 'project-1', ?, 'video.generate', 'submitted', ?, 'xai-oauth',
       'xai-oauth', 'provider-existing', '[]', 1, 1)`)
      .run(dir, JSON.stringify({ prompt: 'resume me' }));

    expect(service.cancel('project-1', 'job-1')).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
    });
    expect(service.stopTracking('project-1', 'job-1')).toMatchObject({
      ok: true,
      job: expect.objectContaining({ status: 'tracking_stopped' }),
    });
    expect(service.resumeTracking('project-1', 'job-1')).toMatchObject({
      ok: true,
      job: expect.objectContaining({ status: 'submitted' }),
    });
    await queue.runNext(service);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(service.get('project-1', 'job-1')).toMatchObject({ status: 'completed' });
  });

  it('does not issue another poll after stop_tracking during retry backoff', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const download = vi.fn();
    const fetch = vi.fn().mockRejectedValue(new Error('temporary poll failure'));
    let releaseBackoff = false;
    const sleep = vi.fn(async () => {
      while (!releaseBackoff) await sleepTimer(1);
    });
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download,
      sleep,
      schedule: queue.schedule,
      retryDelaysMs: [10],
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, created_at, updated_at)
      VALUES ('job-racing', 'project-1', ?, 'video.generate', 'submitted', ?, 'xai-oauth',
       'xai-oauth', 'provider-racing', '[]', 1, 1)`)
      .run(dir, JSON.stringify({ prompt: 'stop during poll' }));

    service.resumePending();
    queue.startNext();
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    expect(service.stopTracking('project-1', 'job-racing')).toMatchObject({ ok: true });
    releaseBackoff = true;
    await service.waitForIdle();

    expect(service.get('project-1', 'job-racing')).toMatchObject({ status: 'tracking_stopped' });
    expect(download).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not let a rejected in-flight download overwrite stop_tracking', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/download-race' } }))
    );
    const download = vi.fn(async () => {
      await sleepTimer(10);
      throw new Error('late rejected download');
    });
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download,
      schedule: queue.schedule,
      retryDelaysMs: [],
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, created_at, updated_at)
      VALUES ('job-download-racing', 'project-1', ?, 'video.generate', 'submitted', ?, 'xai-oauth',
       'xai-oauth', 'provider-download-racing', '[]', 1, 1)`)
      .run(dir, JSON.stringify({ prompt: 'stop during download' }));

    service.resumePending();
    queue.startNext();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(service.stopTracking('project-1', 'job-download-racing')).toMatchObject({ ok: true });
    await service.waitForIdle();

    expect(service.get('project-1', 'job-download-racing')).toMatchObject({ status: 'tracking_stopped' });
  });

  it('retries safe query and download operations without resubmitting creation', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-1' })))
      .mockRejectedValueOnce(new Error('temporary query failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/retry' } })));
    const download = vi.fn()
      .mockRejectedValueOnce(new Error('temporary download failure'))
      .mockResolvedValueOnce({ bytes: Buffer.from('video'), mimeType: 'video/mp4' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download,
      sleep,
      schedule: queue.schedule,
      retryDelaysMs: [10, 20],
    });

    const receipt = await service.submitVideo({ prompt: 'retry safely' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({ status: 'completed' });
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(download).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('keeps a submitted Job recoverable when safe query retries are exhausted', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-retry-later' })))
      .mockRejectedValueOnce(new Error('network still unavailable'));
    const recordTerminal = vi.fn();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
      retryDelaysMs: [],
      recordTerminal,
    });
    const receipt = await service.submitVideo({ prompt: 'do not lose me' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: 'blocked',
      availableActions: ['resume_tracking', 'stop_tracking'],
    });
    expect(recordTerminal).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('blocks a frozen queued route when it becomes unavailable without falling back', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn();
    let available = true;
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => available ? { enabled: true, fetch } : null,
      download: vi.fn(),
      schedule: queue.schedule,
    });
    const receipt = await service.submitVideo({ prompt: 'freeze route', route_hint: 'auto' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);
    available = false;

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: 'blocked',
      connectionId: 'xai-oauth',
    });
    expect(service.stopTracking('project-1', receipt.jobId)).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('recovers queued work and never retries a creation interrupted by restart', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-queued' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', video: { url: 'https://video/queued' } })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('queued'), mimeType: 'video/mp4' }),
      schedule: queue.schedule,
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, submission_attempted, created_at, updated_at)
      VALUES ('job-interrupted', 'project-1', ?, 'video.generate', 'submission_pending', ?,
       'xai-oauth', 'xai-oauth', NULL, '[]', 1, 1, 1)`)
      .run(dir, JSON.stringify({ prompt: 'maybe charged' }));
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, submission_attempted, created_at, updated_at)
      VALUES ('job-queued', 'project-1', ?, 'video.generate', 'queued', ?,
       'xai-oauth', 'xai-oauth', NULL, '[]', 0, 2, 2)`)
      .run(dir, JSON.stringify({ prompt: 'resume queued work' }));

    service.resumePending();

    expect(service.get('project-1', 'job-interrupted')).toMatchObject({
      status: 'submission_unknown',
      availableActions: ['resubmit'],
    });
    await queue.runNext(service);
    expect(service.get('project-1', 'job-queued')).toMatchObject({ status: 'completed' });
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('persists a provider failure as one terminal Conversation event', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const recordTerminal = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-failed' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed' })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      schedule: queue.schedule,
      recordTerminal,
    });
    const receipt = await service.submitVideo({ prompt: 'provider fails' }, dir, 'session-1');
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({ status: 'failed' });
    expect(recordTerminal).toHaveBeenCalledTimes(1);
    expect(recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      id: receipt.jobId,
      status: 'failed',
      sourceSessionId: 'session-1',
    }));
  });

});
