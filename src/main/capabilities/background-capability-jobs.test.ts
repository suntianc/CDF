import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('BackgroundCapabilityJobService', () => {
  it('returns a stable receipt after provider submission and completes in the background', async () => {
    const db = database();
    const dir = await projectDir();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', video: { url: 'https://temporary/video.mp4' } })));
    const recordTerminal = vi.fn();
    const scheduled: Array<() => void> = [];
    const emit = vi.fn();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('video-bytes'), mimeType: 'video/mp4' }),
      sleep: async () => undefined,
      recordTerminal,
      schedule: (task) => scheduled.push(task),
      emit,
    });

    const receipt = await service.submitVideo({ prompt: 'a cat', duration: 5 }, undefined, 'session-1');
    if (!receipt.ok) throw new Error(receipt.error);

    expect(receipt).toMatchObject({ ok: true, jobId: expect.any(String), type: 'video.generate', status: 'queued' });
    expect(service.list('project-1')[0]).toMatchObject({ id: receipt.jobId, status: 'queued' });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ id: receipt.jobId, status: 'queued' }),
    }));
    scheduled[0]();
    await service.waitForIdle();
    const [job] = service.list('project-1');
    expect(job).toMatchObject({ id: receipt.jobId, status: 'completed', provider: 'xai-oauth' });
    expect(job.artifacts).toHaveLength(1);
    await expect(fs.readFile(job.artifacts[0].path, 'utf8')).resolves.toBe('video-bytes');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      id: receipt.jobId,
      sourceSessionId: 'session-1',
      status: 'completed',
    }));
  });

  it('recovers a persisted provider request without creating it again', async () => {
    const db = database();
    const dir = await projectDir();
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, provider_task_id, created_at, updated_at)
      VALUES (?, ?, ?, 'video.generate', 'running', ?, 'xai-oauth', ?, 1, 1)`)
      .run('job-existing', 'project-1', dir, JSON.stringify({ prompt: 'a cat' }), 'provider-existing');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'failed' }))
    );
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ enabled: true, fetch }),
      download: vi.fn(),
      sleep: async () => undefined,
    });

    service.resumePending();
    await service.waitForIdle();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(service.list('project-1')[0]).toMatchObject({ id: 'job-existing', status: 'failed' });
  });
});
