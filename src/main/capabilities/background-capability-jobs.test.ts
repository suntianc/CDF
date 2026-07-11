import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundCapabilityJobService,
  createMiniMaxAuthenticatedFetch,
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

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
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

  it('freezes one local first-frame image before xAI submission and maps only the snapshot to image_url', async () => {
    const db = database();
    const dir = await projectDir();
    const sourcePath = path.join(dir, 'opening.png');
    const original = pngHeader(1600, 900);
    await fs.writeFile(sourcePath, original);
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'image-video-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: { url: 'https://video/image-1' },
      })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('video'), mimeType: 'video/mp4' }),
      schedule: queue.schedule,
    });

    const receipt = await service.submitVideo({
      mode: 'first-frame',
      prompt: 'animate this opening frame',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: sourcePath }],
    }, dir);
    if (!receipt.ok) throw new Error(receipt.error);
    await fs.writeFile(sourcePath, pngHeader(900, 1600));
    await queue.runNext(service);

    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: 'grok-imagine-video',
      prompt: 'animate this opening frame',
      image_url: `data:image/png;base64,${original.toString('base64')}`,
    });
    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: 'completed',
      inputSummary: {
        mode: 'first-frame',
        firstFrame: {
          mimeType: 'image/png',
          sizeBytes: original.length,
          width: 1600,
          height: 900,
          aspectRatio: '16:9',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    const persisted = db.prepare('SELECT input FROM capability_jobs WHERE id = ?')
      .get(receipt.jobId) as { input: string };
    expect(persisted.input).not.toContain(sourcePath);
    expect(persisted.input).not.toContain(original.toString('base64'));
    const input = JSON.parse(persisted.input);
    expect(await fs.readFile(input.first_frame.path)).toEqual(original);
  });

  it('downloads a URL first frame once and reuses its immutable snapshot on explicit resubmission', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const image = pngHeader(900, 1600);
    const fetchInput = vi.fn().mockResolvedValue(new Response(new Uint8Array(image), {
      headers: { 'Content-Type': 'image/png' },
    }));
    const providerFetch = vi.fn().mockRejectedValue(new Error('connection reset'));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: providerFetch }),
      download: vi.fn(),
      fetchInput,
      schedule: queue.schedule,
    });

    const receipt = await service.submitVideo({
      mode: 'first-frame',
      prompt: 'portrait motion',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: 'https://cdn.example.com/opening.png?token=secret' }],
    }, dir);
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);
    const resubmitted = service.resubmit('project-1', receipt.jobId);

    expect(resubmitted.ok).toBe(true);
    expect(fetchInput).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(service.get('project-1', receipt.jobId))).not.toContain('token=secret');
    if (!resubmitted.ok) return;
    expect(resubmitted.job.inputSummary).toEqual(service.get('project-1', receipt.jobId)?.inputSummary);
  });

  it('recovers a queued first-frame Job from SQLite without rereading its deleted source', async () => {
    const db = database();
    const dir = await projectDir();
    const sourcePath = path.join(dir, 'restart-source.png');
    const image = pngHeader(1600, 900);
    await fs.writeFile(sourcePath, image);
    const initialQueue = scheduler();
    const initialService = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: vi.fn() }),
      download: vi.fn(),
      schedule: initialQueue.schedule,
    });
    const receipt = await initialService.submitVideo({
      mode: 'first-frame',
      prompt: 'survive restart',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: sourcePath }],
    }, dir);
    if (!receipt.ok) throw new Error(receipt.error);
    await fs.rm(sourcePath);

    const recoveryQueue = scheduler();
    const fetchInput = vi.fn();
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'recovered-image-video' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: { url: 'https://video/recovered-image' },
      })));
    const recoveredService = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: providerFetch }),
      download: vi.fn().mockResolvedValue({ bytes: Buffer.from('video'), mimeType: 'video/mp4' }),
      fetchInput,
      schedule: recoveryQueue.schedule,
    });

    recoveredService.resumePending();
    await recoveryQueue.runNext(recoveredService);

    expect(fetchInput).not.toHaveBeenCalled();
    expect(JSON.parse(String(providerFetch.mock.calls[0]?.[1]?.body))).toHaveProperty(
      'image_url',
      `data:image/png;base64,${image.toString('base64')}`
    );
    expect(recoveredService.get('project-1', receipt.jobId)).toMatchObject({ status: 'completed' });
  });

  it('rejects invalid first-frame cardinality, role, format, size, dimensions, and ratio before provider creation', async () => {
    const cases: Array<{ name: string; input: Record<string, unknown>; bytes?: Buffer }> = [
      { name: 'missing image', input: { images: [] } },
      {
        name: 'multiple images',
        input: { images: [
          { role: 'first-frame', source: 'fixture' },
          { role: 'first-frame', source: 'fixture' },
        ] },
      },
      {
        name: 'wrong role',
        input: { images: [{ role: 'last-frame', source: 'fixture' }] },
      },
      {
        name: 'unsupported format',
        input: { images: [{ role: 'first-frame', source: 'fixture' }] },
        bytes: Buffer.from('not-an-image'),
      },
      {
        name: 'oversized image',
        input: { images: [{ role: 'first-frame', source: 'fixture' }] },
        bytes: Buffer.alloc(20 * 1024 * 1024 + 1),
      },
      {
        name: 'invalid dimensions',
        input: { images: [{ role: 'first-frame', source: 'fixture' }] },
        bytes: pngHeader(0, 900),
      },
      {
        name: 'unsupported ratio',
        input: { images: [{ role: 'first-frame', source: 'fixture' }] },
        bytes: pngHeader(2000, 400),
      },
    ];

    for (const scenario of cases) {
      const db = database();
      const dir = await projectDir();
      const providerFetch = vi.fn();
      const service = new BackgroundCapabilityJobService(db, {
        resolveProject: () => ({ id: 'project-1', path: dir }),
        resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: providerFetch }),
        download: vi.fn(),
        loadInputSource: vi.fn().mockResolvedValue({
          bytes: scenario.bytes ?? pngHeader(1600, 900),
          mimeType: 'image/png',
        }),
      });
      const result = await service.submitVideo({
        mode: 'first-frame',
        prompt: scenario.name,
        route_hint: 'xai-oauth',
        ...scenario.input,
      } as never, dir);

      expect(result, scenario.name).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
      expect(providerFetch, scenario.name).not.toHaveBeenCalled();
    }
  });

  it('rejects private-network URLs and decoder-rejected images before provider creation', async () => {
    const db = database();
    const dir = await projectDir();
    const providerFetch = vi.fn();
    const fetchInput = vi.fn();
    const privateUrlService = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: providerFetch }),
      download: vi.fn(),
      fetchInput,
    });
    const privateResult = await privateUrlService.submitVideo({
      mode: 'first-frame',
      prompt: 'private URL',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: 'http://127.0.0.1/private.png' }],
    }, dir);

    const decoderService = new BackgroundCapabilityJobService(database(), {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch: providerFetch }),
      download: vi.fn(),
      loadInputSource: vi.fn().mockResolvedValue({
        bytes: pngHeader(1600, 900),
        mimeType: 'image/png',
      }),
      decodeInputImage: vi.fn().mockRejectedValue(new Error('corrupt PNG')),
    });
    const corruptResult = await decoderService.submitVideo({
      mode: 'first-frame',
      prompt: 'corrupt image',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: 'corrupt.png' }],
    }, dir);

    expect(privateResult).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(corruptResult).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchInput).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('keeps xAI text-to-video requests free of image_url', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'text-video-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: { url: 'https://video/text-1' },
      })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('video'), mimeType: 'video/mp4' }),
      schedule: queue.schedule,
    });
    const receipt = await service.submitVideo({ mode: 'text', prompt: 'text only' }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).not.toHaveProperty('image_url');
    expect(request).toMatchObject({ duration: 6, resolution: '480p' });
    expect(service.get('project-1', receipt.jobId)?.inputSummary).toEqual({
      mode: 'text',
      duration: 6,
      resolution: '480p',
    });
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

  it('runs the MiniMax fixture create-query-file-download lifecycle without exposing the credential', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task_id: 'minimax-task-1',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Preparing',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Queueing',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Processing',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Success',
        file_id: 'file-1',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file: { download_url: 'https://video/minimax-1' },
        base_resp: { status_code: 0, status_msg: 'success' },
      })));
    const secret = 'sk-minimax-unique-sentinel-127';
    const authenticatedFetch = createMiniMaxAuthenticatedFetch(secret, transport);
    const download = vi.fn().mockResolvedValue({
      bytes: Buffer.from('fixture-video'),
      mimeType: 'video/mp4',
    });
    const statusMessages: string[] = [];
    const eventPayloads: string[] = [];
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({
        id: 'minimax-token-plan',
        enabled: true,
        fetch: authenticatedFetch,
      }),
      download,
      sleep: async () => undefined,
      schedule: queue.schedule,
      emit: (event) => {
        statusMessages.push(event.job.statusMessage ?? event.job.status);
        eventPayloads.push(JSON.stringify(event));
      },
    });

    const receipt = await service.submitVideo({
      prompt: 'fixture only, not a real Token Plan success',
      route_hint: 'minimax-token-plan',
      duration: 6,
      resolution: '1080P',
    }, dir, 'session-1');
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: 'completed',
      provider: 'minimax-token-plan',
      connectionId: 'minimax-token-plan',
      artifacts: [expect.objectContaining({ mimeType: 'video/mp4' })],
    });
    expect(db.prepare(
      'SELECT id, provider_task_id, input FROM capability_jobs WHERE id = ?'
    ).get(receipt.jobId)).toMatchObject({
      id: receipt.jobId,
      provider_task_id: 'minimax-task-1',
      input: expect.not.stringContaining(secret),
    });
    expect(statusMessages).toEqual(expect.arrayContaining([
      'provider_preparing',
      'provider_queueing',
      'provider_processing',
      'downloading_provider_result',
      'artifact_durable',
    ]));
    expect(transport).toHaveBeenCalledTimes(6);
    expect(transport.mock.calls[0][0]).toBe('https://api.minimaxi.com/v1/video_generation');
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({
      model: 'MiniMax-Hailuo-2.3',
      prompt: 'fixture only, not a real Token Plan success',
      duration: 6,
      resolution: '1080P',
    });
    expect(transport.mock.calls[1][0]).toContain('/v1/query/video_generation?task_id=minimax-task-1');
    expect(transport.mock.calls[5][0]).toContain('/v1/files/retrieve?file_id=file-1');
    expect((transport.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe(
      `Bearer ${secret}`
    );
    expect(JSON.stringify(service.get('project-1', receipt.jobId))).not.toContain(secret);
    expect(eventPayloads.join('\n')).not.toContain(secret);
    expect(download).toHaveBeenCalledWith('https://video/minimax-1');
  });

  it('rejects unsupported MiniMax duration and resolution combinations before provider creation', async () => {
    const db = database();
    const dir = await projectDir();
    const fetch = vi.fn();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'minimax-token-plan', enabled: true, fetch }),
      download: vi.fn(),
      schedule: scheduler().schedule,
    });

    await expect(service.submitVideo({
      prompt: 'unsupported combination',
      route_hint: 'minimax-token-plan',
      duration: 10,
      resolution: '1080P',
    }, dir)).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(service.list('project-1')).toEqual([]);
  });
  it('preserves xAI duration and resolution constraints before provider creation', async () => {
    const db = database();
    const dir = await projectDir();
    const fetch = vi.fn();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch }),
      download: vi.fn(),
      schedule: scheduler().schedule,
    });

    await expect(service.submitVideo({
      prompt: 'invalid xAI duration',
      route_hint: 'xai-oauth',
      duration: 0,
      resolution: '720p',
    }, dir)).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    await expect(service.submitVideo({
      prompt: 'invalid xAI resolution',
      route_hint: 'xai-oauth',
      duration: 5,
      resolution: '1080P',
    }, dir)).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(fetch).not.toHaveBeenCalled();
    expect(service.list('project-1')).toEqual([]);
  });

  it.each([
    {
      name: 'HTTP authentication failure',
      responses: [new Response('invalid token', { status: 401 })],
      expectedStatus: 'failed',
      expectedError: '[AUTHENTICATION:401]',
    },
    {
      name: 'HTTP quota failure with unknown provider acceptance',
      responses: [new Response('quota exceeded', { status: 429 })],
      expectedStatus: 'submission_unknown',
      expectedError: '[QUOTA:429]',
    },
    {
      name: 'base response quota failure',
      responses: [new Response(JSON.stringify({
        base_resp: { status_code: 1008, status_msg: 'insufficient balance' },
      }))],
      expectedStatus: 'failed',
      expectedError: '[QUOTA:1008]',
    },
    {
      name: 'base response content safety failure',
      responses: [new Response(JSON.stringify({
        base_resp: { status_code: 1026, status_msg: '视频描述涉及敏感内容' },
      }))],
      expectedStatus: 'failed',
      expectedError: '[CONTENT_SAFETY:1026]',
    },
    {
      name: 'invalid creation response',
      responses: [new Response(JSON.stringify({ base_resp: { status_code: 0 } }))],
      expectedStatus: 'submission_unknown',
      expectedError: 'no usable task_id',
    },
    {
      name: 'unknown task status',
      responses: [
        new Response(JSON.stringify({
          task_id: 'task-unknown',
          base_resp: { status_code: 0, status_msg: 'success' },
        })),
        new Response(JSON.stringify({
          status: 'Unexpected',
          base_resp: { status_code: 0, status_msg: 'success' },
        })),
      ],
      expectedStatus: 'failed',
      expectedError: 'Unknown MiniMax video generation status',
    },
    {
      name: 'query base response authentication failure',
      responses: [
        new Response(JSON.stringify({
          task_id: 'task-query-auth',
          base_resp: { status_code: 0, status_msg: 'success' },
        })),
        new Response(JSON.stringify({
          base_resp: { status_code: 1004, status_msg: 'invalid api key' },
        })),
      ],
      expectedStatus: 'failed',
      expectedError: '[AUTHENTICATION:1004]',
    },
    {
      name: 'success without file id',
      responses: [
        new Response(JSON.stringify({
          task_id: 'task-no-file',
          base_resp: { status_code: 0, status_msg: 'success' },
        })),
        new Response(JSON.stringify({
          status: 'Success',
          base_resp: { status_code: 0, status_msg: 'success' },
        })),
      ],
      expectedStatus: 'failed',
      expectedError: 'no file_id',
    },
  ])('returns a stable diagnostic for MiniMax $name', async ({
    responses,
    expectedStatus,
    expectedError,
  }) => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn();
    for (const response of responses) fetch.mockResolvedValueOnce(response);
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'minimax-token-plan', enabled: true, fetch }),
      download: vi.fn(),
      sleep: async () => undefined,
      schedule: queue.schedule,
    });
    const receipt = await service.submitVideo({
      prompt: 'diagnostic fixture',
      route_hint: 'minimax-token-plan',
      duration: 6,
      resolution: '768P',
    }, dir);
    if (!receipt.ok) throw new Error(receipt.error);

    await queue.runNext(service);

    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      status: expectedStatus,
      error: expect.stringContaining(expectedError),
    });
  });

  it('diagnoses empty MiniMax file retrieval and downloaded content', async () => {
    const cases = [
      {
        fileResponse: {
          file: { download_url: '' },
          base_resp: { status_code: 0, status_msg: 'success' },
        },
        bytes: Buffer.from('unused'),
        error: 'no download_url',
      },
      {
        fileResponse: {
          file: { download_url: 'https://video/empty' },
          base_resp: { status_code: 0, status_msg: 'success' },
        },
        bytes: Buffer.alloc(0),
        error: 'Downloaded generated video is empty',
      },
    ];
    for (const scenario of cases) {
      const db = database();
      const dir = await projectDir();
      const queue = scheduler();
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          task_id: 'task-empty',
          base_resp: { status_code: 0, status_msg: 'success' },
        })))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          status: 'Success',
          file_id: 'file-empty',
          base_resp: { status_code: 0, status_msg: 'success' },
        })))
        .mockResolvedValueOnce(new Response(JSON.stringify(scenario.fileResponse)));
      const service = new BackgroundCapabilityJobService(db, {
        resolveProject: () => ({ id: 'project-1', path: dir }),
        resolveRoute: () => ({ id: 'minimax-token-plan', enabled: true, fetch }),
        download: vi.fn().mockResolvedValue({ bytes: scenario.bytes, mimeType: 'video/mp4' }),
        schedule: queue.schedule,
      });
      const receipt = await service.submitVideo({
        prompt: 'empty result fixture',
        route_hint: 'minimax-token-plan',
      }, dir);
      if (!receipt.ok) throw new Error(receipt.error);

      await queue.runNext(service);

      expect(service.get('project-1', receipt.jobId)).toMatchObject({
        status: 'failed',
        error: expect.stringContaining(scenario.error),
      });
    }
  });

  it('continues querying and downloading a submitted MiniMax task after its new-job switch is disabled', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Success',
        file_id: 'file-existing',
        base_resp: { status_code: 0, status_msg: 'success' },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file: { download_url: 'https://video/existing' },
        base_resp: { status_code: 0, status_msg: 'success' },
      })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'minimax-token-plan', enabled: false, fetch }),
      download: vi.fn().mockResolvedValue({
        bytes: Buffer.from('existing-video'),
        mimeType: 'video/mp4',
      }),
      schedule: queue.schedule,
    });
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, created_at, updated_at)
      VALUES ('job-minimax-existing', 'project-1', ?, 'video.generate', 'submitted', ?,
       'minimax-token-plan', 'minimax-token-plan', 'task-existing', '[]', 1, 1)`)
      .run(dir, JSON.stringify({
        prompt: 'already submitted',
        route_hint: 'minimax-token-plan',
        duration: 6,
        resolution: '768P',
      }));

    service.resumePending();
    await queue.runNext(service);

    expect(service.get('project-1', 'job-minimax-existing')).toMatchObject({
      status: 'completed',
      provider: 'minimax-token-plan',
    });
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
  });


});
