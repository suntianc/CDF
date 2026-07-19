import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundCapabilityJobService,
  CAPABILITY_JOB_RETENTION_MS,
  initializeCapabilityJobSchema,
} from './background-capability-jobs';
import { CapabilityJobContinuationCoordinator } from './capability-job-continuations';
import { videoInputSnapshotDir } from './video-input-snapshot';

const tempDirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdf-job-retention-'));
  tempDirs.push(dir);
  return dir;
}

function database(): Database.Database {
  const db = new Database(':memory:');
  initializeCapabilityJobSchema(db);
  return db;
}

function scheduler() {
  const tasks: Array<() => void> = [];
  return {
    schedule: (task: () => void) => tasks.push(task),
    async runNext(service: BackgroundCapabilityJobService): Promise<void> {
      const task = tasks.shift();
      if (!task) throw new Error('No scheduled Job runner');
      task();
      await service.waitForIdle();
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Background Capability Job retention', () => {
  it('keeps terminal details for 30 days, then leaves an explanatory tombstone and MP4 artifact', async () => {
    const db = database();
    const dir = await projectDir();
    const queue = scheduler();
    let now = 1_000_000;
    const firstFrame = path.join(dir, 'opening.png');
    await fs.writeFile(firstFrame, Buffer.from(
      '89504e470d0a1a0a0000000d494844520000064000000384',
      'hex',
    ));
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-retained' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: { url: 'https://video.example/retained' },
      })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('paid-video'), mimeType: 'video/mp4' }),
      decodeInputImage: async () => ({ width: 1600, height: 900 }),
      schedule: queue.schedule,
      now: () => now,
    });

    const receipt = await service.submitVideo({
      prompt: 'retain this request',
      mode: 'first-frame',
      route_hint: 'xai-oauth',
      images: [{ role: 'first-frame', source: firstFrame }],
    }, dir, 'conversation-1');
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);
    const completed = service.get('project-1', receipt.jobId);
    const artifactPath = completed?.artifacts[0]?.path;
    if (!artifactPath) throw new Error('fixture did not produce an artifact');

    now += CAPABILITY_JOB_RETENTION_MS - 1;
    await service.cleanupExpired();
    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      detailsPruned: false,
      inputSummary: { mode: 'first-frame' },
      terminalAt: 1_000_000,
    });
    await expect(fs.stat(videoInputSnapshotDir(dir, receipt.jobId))).resolves.toBeTruthy();

    now += 1;
    await service.cleanupExpired();
    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      id: receipt.jobId,
      sourceSessionId: 'conversation-1',
      type: 'video.generate',
      status: 'completed',
      detailsPruned: true,
      createdAt: 1_000_000,
      terminalAt: 1_000_000,
      artifacts: [{ path: artifactPath, mimeType: 'video/mp4' }],
    });
    expect(service.get('project-1', receipt.jobId)?.inputSummary).toBeUndefined();
    await expect(fs.stat(videoInputSnapshotDir(dir, receipt.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(artifactPath)).resolves.toEqual(Buffer.from('paid-video'));
  });

  it('keeps the Conversation completion event explanatory after Job details expire', async () => {
    const db = database();
    const dir = await projectDir();
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
      INSERT INTO projects (id, path) VALUES ('project-1', '${dir.replaceAll("'", "''")}');
      INSERT INTO sessions (id, project_id, agent_id)
        VALUES ('conversation-1', 'project-1', 'agent-1');
    `);
    const coordinator = new CapabilityJobContinuationCoordinator(db, {
      runContinuation: vi.fn(),
      schedule: vi.fn(),
    });
    const queue = scheduler();
    let now = 20_000;
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'provider-history' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'done',
        video: { url: 'https://video.example/history' },
      })));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => ({ id: 'xai-oauth', enabled: true, fetch }),
      download: async () => ({ bytes: Buffer.from('history-video'), mimeType: 'video/mp4' }),
      schedule: queue.schedule,
      now: () => now,
      recordTerminal: (job) => coordinator.enqueue(job),
    });
    const receipt = await service.submitVideo(
      { prompt: 'history survives', route_hint: 'xai-oauth' },
      dir,
      'conversation-1',
    );
    if (!receipt.ok) throw new Error(receipt.error);
    await queue.runNext(service);

    now += CAPABILITY_JOB_RETENTION_MS;
    await service.cleanupExpired();

    const message = db.prepare('SELECT content FROM messages WHERE id = ?')
      .get(`capability-job:${receipt.jobId}:terminal`) as { content: string };
    expect(JSON.parse(message.content)).toMatchObject({
      type: 'capability_job_event',
      jobId: receipt.jobId,
      status: 'completed',
      artifacts: [{ mimeType: 'video/mp4', path: expect.stringMatching(/\.mp4$/) }],
    });
    expect(service.get('project-1', receipt.jobId)).toMatchObject({
      detailsPruned: true,
      artifacts: [{ mimeType: 'video/mp4' }],
    });
  });

  it('never starts retention for queued, active, blocked, stopped, or unknown Jobs', async () => {
    const db = database();
    const dir = await projectDir();
    const old = 1_000;
    const statuses = [
      'queued',
      'submission_pending',
      'submitted',
      'running',
      'downloading',
      'blocked',
      'tracking_stopped',
      'submission_unknown',
    ] as const;
    for (const status of statuses) {
      const id = `job-${status}`;
      const snapshotDir = videoInputSnapshotDir(dir, id);
      await fs.mkdir(snapshotDir, { recursive: true });
      await fs.writeFile(path.join(snapshotDir, 'first-frame.png'), 'input');
      db.prepare(`INSERT INTO capability_jobs
        (id, project_id, project_path, type, status, input, provider, connection_id,
         provider_task_id, source_session_id, artifacts, created_at, updated_at)
        VALUES (?, 'project-1', ?, 'video.generate', ?, ?, 'xai-oauth', 'xai-oauth',
         ?, 'conversation-1', '[]', ?, ?)`).run(
        id,
        dir,
        status,
        JSON.stringify({ prompt: 'still needed', mode: 'first-frame' }),
        ['submitted', 'running', 'downloading', 'blocked', 'tracking_stopped'].includes(status)
          ? `provider-${status}`
          : null,
        old,
        old,
      );
    }
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => ({ id: 'project-1', path: dir }),
      resolveRoute: () => null,
      download: vi.fn(),
      now: () => old + CAPABILITY_JOB_RETENTION_MS * 2,
    });

    await service.cleanupExpired();

    for (const status of statuses) {
      const id = `job-${status}`;
      expect(service.get('project-1', id)).toMatchObject({ status, detailsPruned: false });
      await expect(fs.stat(videoInputSnapshotDir(dir, id))).resolves.toBeTruthy();
    }
  });

  it('refuses to resubmit a pruned first-frame Job and asks for a new image', () => {
    const db = database();
    const now = 50_000;
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, source_session_id, artifacts, created_at, updated_at,
       details_pruned, pruned_at)
      VALUES ('job-pruned', 'project-1', '/project', 'video.generate', 'submission_unknown',
       '{}', 'xai-oauth', 'xai-oauth', NULL, 'conversation-1', '[]', 1, 2, 1, 3)`).run();
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => null,
      resolveRoute: () => null,
      download: vi.fn(),
      now: () => now,
    });

    expect(service.resubmit('project-1', 'job-pruned')).toEqual({
      ok: false,
      error: 'The retained input snapshot was cleaned up; provide the first-frame image again',
      code: 'INPUT_SNAPSHOT_REQUIRED',
    });
  });

  it('retries interrupted snapshot cleanup without touching artifacts or active Jobs', async () => {
    const db = database();
    const dir = await projectDir();
    const artifact = path.join(dir, '.cdf', 'artifacts', 'videos', 'paid.mp4');
    const expiredSnapshot = videoInputSnapshotDir(dir, 'job-expired');
    const activeSnapshot = videoInputSnapshotDir(dir, 'job-active');
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    await fs.writeFile(artifact, 'paid');
    await fs.mkdir(expiredSnapshot, { recursive: true });
    await fs.mkdir(activeSnapshot, { recursive: true });
    await fs.writeFile(path.join(expiredSnapshot, 'first-frame.png'), 'expired');
    await fs.writeFile(path.join(activeSnapshot, 'first-frame.png'), 'active');
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, artifacts, created_at, updated_at, terminal_at)
      VALUES ('job-expired', 'project-1', ?, 'video.generate', 'completed', ?,
       'xai-oauth', 'xai-oauth', 'provider-expired', ?, 1, 2, 2)`).run(
      dir,
      JSON.stringify({ prompt: 'secret request', mode: 'first-frame' }),
      JSON.stringify([{ path: artifact, mimeType: 'video/mp4' }]),
    );
    db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       artifacts, created_at, updated_at)
      VALUES ('job-active', 'project-1', ?, 'video.generate', 'queued', ?,
       'xai-oauth', 'xai-oauth', '[]', 1, 1)`).run(
      dir,
      JSON.stringify({ prompt: 'active request', mode: 'first-frame' }),
    );
    const removeInputSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('simulated crash'))
      .mockImplementation((projectPath: string, jobId: string) =>
        fs.rm(videoInputSnapshotDir(projectPath, jobId), { recursive: true, force: true }));
    const service = new BackgroundCapabilityJobService(db, {
      resolveProject: () => null,
      resolveRoute: () => null,
      download: vi.fn(),
      removeInputSnapshot,
      now: () => CAPABILITY_JOB_RETENTION_MS + 2,
    });

    await service.cleanupExpired();
    expect(service.get('project-1', 'job-expired')).toMatchObject({ detailsPruned: true });
    await expect(fs.stat(expiredSnapshot)).resolves.toBeTruthy();

    await service.cleanupExpired();
    await service.cleanupExpired();
    await expect(fs.stat(expiredSnapshot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(artifact, 'utf8')).resolves.toBe('paid');
    await expect(fs.readFile(path.join(activeSnapshot, 'first-frame.png'), 'utf8')).resolves.toBe('active');
    expect(service.get('project-1', 'job-active')).toMatchObject({ detailsPruned: false });
  });
});
