import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import type {
  CapabilityJobArtifact,
  CapabilityJobEvent,
  CapabilityJobSnapshot,
  CapabilityJobStatus,
  CapabilityJobSubmissionResult,
} from '../../shared/capability-jobs';
import { XAI_RESPONSES_API_BASE_URL } from '../ai-subscription-runtime';
import type { GenerateVideoInput, XaiVideoRoute } from './generate-video';

interface CapabilityJobRow {
  id: string;
  project_id: string;
  project_path: string;
  type: 'video.generate';
  status: CapabilityJobStatus;
  input: string;
  provider: 'xai-oauth';
  provider_task_id: string | null;
  source_session_id: string | null;
  artifacts: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CapabilityJobServiceDeps {
  resolveProject: (projectPath: string) => { id: string; path: string } | null;
  resolveRoute: () => XaiVideoRoute | null;
  download: (url: string) => Promise<{ bytes: Buffer; mimeType: string }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  recordTerminal?: (job: CapabilityJobSnapshot) => void;
  emit?: (event: CapabilityJobEvent) => void;
  pollIntervalMs?: number;
  schedule?: (task: () => void) => void;
}

export function initializeCapabilityJobSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      input TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_task_id TEXT,
      source_session_id TEXT,
      artifacts TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_capability_jobs_project_created
      ON capability_jobs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_capability_jobs_status
      ON capability_jobs(status);
  `);
  const columns = db.prepare('PRAGMA table_info(capability_jobs)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'source_session_id')) {
    db.exec('ALTER TABLE capability_jobs ADD COLUMN source_session_id TEXT');
  }
}

export class BackgroundCapabilityJobService {
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly db: Database.Database,
    private readonly deps: CapabilityJobServiceDeps
  ) {
    initializeCapabilityJobSchema(db);
  }

  async submitVideo(input: GenerateVideoInput, projectPath?: string, sourceSessionId?: string): Promise<CapabilityJobSubmissionResult> {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt is required', code: 'INVALID_INPUT' };
    if (input.route_hint && input.route_hint !== 'auto' && input.route_hint !== 'xai-oauth') {
      return { ok: false, error: `Unsupported video route: ${input.route_hint}`, code: 'ROUTE_UNAVAILABLE' };
    }
    const project = this.deps.resolveProject(projectPath ?? '');
    if (!project) return { ok: false, error: 'Project not found', code: 'PROJECT_NOT_FOUND' };
    const route = this.deps.resolveRoute();
    if (!route) return { ok: false, error: 'xAI Grok OAuth is not connected for video generation', code: 'ROUTE_UNAVAILABLE' };
    if (!route.enabled) return { ok: false, error: 'xAI Grok OAuth video generation is disabled', code: 'CAPABILITY_DISABLED' };

    const body: Record<string, unknown> = { model: 'grok-imagine-video', prompt };
    if (input.duration !== undefined) body.duration = input.duration;
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (input.resolution) body.resolution = input.resolution;

    let response: Response;
    try {
      response = await route.fetch(`${XAI_RESPONSES_API_BASE_URL}/videos/generations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (error) {
      return { ok: false, error: message(error), code: 'PROVIDER_REQUEST_ERROR' };
    }
    const created = await readProviderJson(response);
    if (!created.ok) return created.error;
    const providerTaskId = typeof created.body.request_id === 'string' ? created.body.request_id.trim() : '';
    if (!providerTaskId) return { ok: false, error: 'xAI video generation returned no request_id', code: 'PROVIDER_RESPONSE' };

    const id = crypto.randomUUID();
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, provider_task_id, source_session_id, artifacts, error, created_at, updated_at)
      VALUES (?, ?, ?, 'video.generate', 'queued', ?, 'xai-oauth', ?, ?, '[]', NULL, ?, ?)`)
      .run(id, project.id, project.path, JSON.stringify({ ...input, prompt }), providerTaskId, sourceSessionId ?? null, now, now);
    this.emit(id);
    (this.deps.schedule ?? ((task) => setTimeout(task, 0)))(() => this.start(id));
    return { ok: true, jobId: id, type: 'video.generate', status: 'queued' };
  }

  list(projectId: string): CapabilityJobSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM capability_jobs WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as CapabilityJobRow[];
    return rows.map(toSnapshot);
  }

  resumePending(): void {
    const rows = this.db.prepare(
      "SELECT id FROM capability_jobs WHERE status IN ('queued', 'running', 'downloading') AND provider_task_id IS NOT NULL"
    ).all() as Array<{ id: string }>;
    for (const row of rows) this.start(row.id);
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  private start(id: string): void {
    const task = this.run(id).finally(() => this.running.delete(task));
    this.running.add(task);
  }

  private async run(id: string): Promise<void> {
    const row = this.getRow(id);
    if (!row?.provider_task_id) return;
    try {
      this.transition(id, 'running');
      const route = this.deps.resolveRoute();
      if (!route?.enabled) throw new Error('xAI Grok OAuth is unavailable for video generation');
      const sleep = this.deps.sleep ?? sleepTimer;
      let videoUrl = '';
      for (;;) {
        const response = await route.fetch(
          `${XAI_RESPONSES_API_BASE_URL}/videos/${encodeURIComponent(row.provider_task_id)}`,
          { method: 'GET' }
        );
        const polled = await readProviderJson(response);
        if (!polled.ok) throw new Error(polled.error.error);
        const status = typeof polled.body.status === 'string' ? polled.body.status : '';
        if (status === 'done') {
          const video = polled.body.video as Record<string, unknown> | undefined;
          videoUrl = typeof video?.url === 'string' ? video.url.trim() : '';
          if (!videoUrl) throw new Error('xAI video generation returned no video URL');
          break;
        }
        if (status === 'failed' || status === 'expired') throw new Error(`xAI video generation ${status}`);
        if (status !== 'pending' && status !== 'in_progress') throw new Error(`Unknown xAI video generation status: ${status || 'missing'}`);
        await sleep(this.deps.pollIntervalMs ?? 5_000);
      }
      this.transition(id, 'downloading');
      const downloaded = await this.deps.download(videoUrl);
      if (downloaded.bytes.length === 0) throw new Error('Downloaded generated video is empty');
      const artifactPath = await writeAtomicVideoArtifact(row.project_path, downloaded.bytes);
      this.complete(id, [{ path: artifactPath, mimeType: downloaded.mimeType || 'video/mp4' }]);
    } catch (error) {
      this.fail(id, message(error));
    }
  }

  private getRow(id: string): CapabilityJobRow | undefined {
    return this.db.prepare('SELECT * FROM capability_jobs WHERE id = ?').get(id) as CapabilityJobRow | undefined;
  }

  private transition(id: string, status: CapabilityJobStatus): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare('UPDATE capability_jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    this.emit(id);
  }

  private complete(id: string, artifacts: CapabilityJobArtifact[]): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare("UPDATE capability_jobs SET status = 'completed', artifacts = ?, error = NULL, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(artifacts), now, id);
    const row = this.getRow(id);
    if (row) {
      try {
        this.deps.recordTerminal?.(toSnapshot(row));
      } catch {
        // A failed Conversation projection must not change the durable Job result.
      }
    }
    this.emit(id);
  }

  private fail(id: string, error: string): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare("UPDATE capability_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(error, now, id);
    const row = this.getRow(id);
    if (row) {
      try {
        this.deps.recordTerminal?.(toSnapshot(row));
      } catch {
        // Preserve the Job failure even if its Conversation projection cannot be written.
      }
    }
    this.emit(id);
  }

  private emit(id: string): void {
    const row = this.getRow(id);
    if (row) this.deps.emit?.({ projectId: row.project_id, job: toSnapshot(row) });
  }
}

export async function writeAtomicVideoArtifact(projectPath: string, bytes: Buffer): Promise<string> {
  const dir = path.join(projectPath, '.cdf', 'artifacts', 'videos');
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `video-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`);
  const temporary = `${target}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
    return target;
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function toSnapshot(row: CapabilityJobRow): CapabilityJobSnapshot {
  let artifacts: CapabilityJobArtifact[] = [];
  try { artifacts = JSON.parse(row.artifacts ?? '[]') as CapabilityJobArtifact[]; } catch { artifacts = []; }
  return {
    id: row.id, sourceSessionId: row.source_session_id ?? undefined,
    projectId: row.project_id, type: row.type, status: row.status,
    provider: row.provider, artifacts, error: row.error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function readProviderJson(response: Response): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: { ok: false; error: string; code: string } }
> {
  const raw = await response.text();
  if (!response.ok) return { ok: false, error: { ok: false, error: `xAI video generation failed (${response.status}): ${raw.slice(0, 500) || 'unknown provider error'}`, code: 'PROVIDER_HTTP_ERROR' } };
  try { return { ok: true, body: JSON.parse(raw) as Record<string, unknown> }; }
  catch { return { ok: false, error: { ok: false, error: 'Invalid xAI video response', code: 'PROVIDER_RESPONSE' } }; }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
