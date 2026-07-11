import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  CapabilityJobAction,
  CapabilityJobArtifact,
  CapabilityJobCommandResult,
  CapabilityJobEvent,
  CapabilityJobSnapshot,
  CapabilityJobStatusMessage,
  CapabilityJobStatus,
  CapabilityJobSubmissionResult,
} from '../../shared/capability-jobs';
import { XAI_RESPONSES_API_BASE_URL } from '../ai-subscription-runtime';
import type { GenerateVideoInput, XaiVideoRoute } from './generate-video';

const XaiCreateResponseSchema = z.object({ request_id: z.string().trim().min(1) });
const XaiPollResponseSchema = z.object({
  status: z.string(),
  video: z.object({ url: z.string() }).optional(),
});

interface CapabilityJobRow {
  id: string;
  project_id: string;
  project_path: string;
  type: 'video.generate';
  status: CapabilityJobStatus;
  input: string;
  provider: 'xai-oauth';
  connection_id: 'xai-oauth';
  provider_task_id: string | null;
  source_session_id: string | null;
  related_job_id: string | null;
  artifacts: string | null;
  error: string | null;
  status_message: CapabilityJobStatusMessage | null;
  submission_attempted: number;
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
  retryDelaysMs?: number[];
  schedule?: (task: () => void) => void;
  submissionTimeoutMs?: number;
}

const ACTIVE_SLOT_STATUSES: CapabilityJobStatus[] = [
  'submission_pending',
  'submitted',
  'running',
  'downloading',
  'blocked',
  'tracking_stopped',
];

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
      connection_id TEXT NOT NULL DEFAULT 'xai-oauth',
      provider_task_id TEXT,
      source_session_id TEXT,
      related_job_id TEXT,
      artifacts TEXT,
      error TEXT,
      status_message TEXT,
      submission_attempted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_capability_jobs_project_created
      ON capability_jobs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_capability_jobs_status
      ON capability_jobs(status);
  `);
  const columns = db.prepare('PRAGMA table_info(capability_jobs)').all() as Array<{ name: string }>;
  const migrations: Record<string, string> = {
    source_session_id: 'ALTER TABLE capability_jobs ADD COLUMN source_session_id TEXT',
    connection_id: "ALTER TABLE capability_jobs ADD COLUMN connection_id TEXT NOT NULL DEFAULT 'xai-oauth'",
    related_job_id: 'ALTER TABLE capability_jobs ADD COLUMN related_job_id TEXT',
    status_message: 'ALTER TABLE capability_jobs ADD COLUMN status_message TEXT',
    submission_attempted: 'ALTER TABLE capability_jobs ADD COLUMN submission_attempted INTEGER NOT NULL DEFAULT 0',
  };
  for (const [column, sql] of Object.entries(migrations)) {
    if (!columns.some((entry) => entry.name === column)) db.exec(sql);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_capability_jobs_connection_queue
    ON capability_jobs(connection_id, status, created_at)`);
}

export class BackgroundCapabilityJobService {
  private readonly running = new Set<Promise<void>>();
  private readonly runningJobIds = new Set<string>();

  constructor(
    private readonly db: Database.Database,
    private readonly deps: CapabilityJobServiceDeps
  ) {
    initializeCapabilityJobSchema(db);
  }

  async submitVideo(
    input: GenerateVideoInput,
    projectPath?: string,
    sourceSessionId?: string
  ): Promise<CapabilityJobSubmissionResult> {
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

    const id = crypto.randomUUID();
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, source_session_id, related_job_id, artifacts, error,
       status_message, submission_attempted, created_at, updated_at)
      VALUES (?, ?, ?, 'video.generate', 'queued', ?, 'xai-oauth', 'xai-oauth',
       NULL, ?, NULL, '[]', NULL, 'waiting_connection_slot', 0, ?, ?)`)
      .run(id, project.id, project.path, JSON.stringify({ ...input, prompt, route_hint: 'xai-oauth' }), sourceSessionId ?? null, now, now);
    this.emit(id);
    this.schedulePump('xai-oauth');
    return { ok: true, jobId: id, type: 'video.generate', status: 'queued' };
  }

  list(projectId: string): CapabilityJobSnapshot[] {
    const rows = this.db.prepare(
      'SELECT * FROM capability_jobs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC'
    ).all(projectId) as CapabilityJobRow[];
    return rows.map((row) => this.toSnapshot(row));
  }

  get(projectId: string, jobId: string): CapabilityJobSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM capability_jobs WHERE project_id = ? AND id = ?'
    ).get(projectId, jobId) as CapabilityJobRow | undefined;
    return row ? this.toSnapshot(row) : null;
  }

  cancel(projectId: string, jobId: string): CapabilityJobCommandResult {
    const row = this.findProjectRow(projectId, jobId);
    if (!row || (row.status !== 'queued' && !(row.status === 'blocked' && !row.provider_task_id))) {
      return { ok: false, error: 'Only unsubmitted queued work can be canceled', code: 'INVALID_STATE' };
    }
    this.updateState(jobId, 'canceled', null, null);
    this.schedulePump(row.connection_id);
    return { ok: true, job: this.toSnapshot(this.getRow(jobId)!) };
  }

  stopTracking(projectId: string, jobId: string): CapabilityJobCommandResult {
    const row = this.findProjectRow(projectId, jobId);
    const submitted = row && ['submitted', 'running', 'downloading'].includes(row.status);
    const blockedSubmitted = row?.status === 'blocked' && Boolean(row.provider_task_id);
    if (!row || (!submitted && !blockedSubmitted)) {
      return { ok: false, error: 'Only submitted work can stop local tracking', code: 'INVALID_STATE' };
    }
    this.updateState(jobId, 'tracking_stopped', null, 'tracking_stopped_remote_continues');
    return { ok: true, job: this.toSnapshot(this.getRow(jobId)!) };
  }
  resumeTracking(projectId: string, jobId: string): CapabilityJobCommandResult {
    const row = this.findProjectRow(projectId, jobId);
    if (!row || !['tracking_stopped', 'blocked'].includes(row.status) || !row.provider_task_id) {
      return { ok: false, error: 'Only a stopped or blocked submitted Job can resume tracking', code: 'INVALID_STATE' };
    }
    this.updateState(jobId, 'submitted', null, null);
    this.scheduleJob(jobId);
    return { ok: true, job: this.toSnapshot(this.getRow(jobId)!) };
  }

  resubmit(projectId: string, jobId: string): CapabilityJobCommandResult {
    const source = this.findProjectRow(projectId, jobId);
    if (!source || source.status !== 'submission_unknown') {
      return { ok: false, error: 'Only an unknown submission can be explicitly resubmitted', code: 'INVALID_STATE' };
    }
    const id = crypto.randomUUID();
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, source_session_id, related_job_id, artifacts, error,
       status_message, submission_attempted, created_at, updated_at)
      VALUES (?, ?, ?, 'video.generate', 'queued', ?, ?, ?, NULL, ?, ?, '[]', NULL,
       'explicit_resubmission_risk', 0, ?, ?)`)
      .run(id, source.project_id, source.project_path, source.input, source.provider,
        source.connection_id, source.source_session_id, source.id, now, now);
    this.emit(id);
    this.schedulePump(source.connection_id);
    return { ok: true, job: this.toSnapshot(this.getRow(id)!) };
  }

  resumePending(): void {
    const uncertain = this.db.prepare(
      "SELECT id FROM capability_jobs WHERE status = 'submission_pending' AND provider_task_id IS NULL"
    ).all() as Array<{ id: string }>;
    for (const row of uncertain) {
      this.updateState(row.id, 'submission_unknown', 'Application stopped during provider submission',
        'submission_unknown_no_retry');
    }
    const submitted = this.db.prepare(
      "SELECT id FROM capability_jobs WHERE status IN ('submitted', 'running', 'downloading') AND provider_task_id IS NOT NULL"
    ).all() as Array<{ id: string }>;
    for (const row of submitted) this.scheduleJob(row.id);
    const blocked = this.db.prepare(
      "SELECT id, provider_task_id FROM capability_jobs WHERE status = 'blocked'"
    ).all() as Array<{ id: string; provider_task_id: string | null }>;
    for (const row of blocked) {
      if (row.provider_task_id) {
        this.updateState(row.id, 'submitted', null, null);
        this.scheduleJob(row.id);
      } else {
        this.updateState(row.id, 'queued', null, 'waiting_connection_slot');
      }
    }
    this.schedulePump('xai-oauth');
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  private schedulePump(connectionId: 'xai-oauth'): void {
    (this.deps.schedule ?? ((task) => setTimeout(task, 0)))(() => {
      const jobId = this.acquireQueuedSlot(connectionId);
      if (jobId) this.start(jobId);
    });
  }

  private scheduleJob(jobId: string): void {
    (this.deps.schedule ?? ((task) => setTimeout(task, 0)))(() => this.start(jobId));
  }
  private start(id: string): void {
    if (this.runningJobIds.has(id)) return;
    this.runningJobIds.add(id);
    const task = this.run(id).finally(() => {
      this.running.delete(task);
      this.runningJobIds.delete(id);
    });
    this.running.add(task);
  }


  private acquireQueuedSlot(connectionId: 'xai-oauth'): string | null {
    const placeholders = ACTIVE_SLOT_STATUSES.map(() => '?').join(', ');
    const acquire = this.db.transaction(() => {
      const active = this.db.prepare(
        `SELECT id FROM capability_jobs WHERE connection_id = ? AND status IN (${placeholders}) LIMIT 1`
      ).get(connectionId, ...ACTIVE_SLOT_STATUSES);
      if (active) return null;
      const next = this.db.prepare(
        "SELECT id FROM capability_jobs WHERE connection_id = ? AND status = 'queued' ORDER BY created_at, rowid LIMIT 1"
      ).get(connectionId) as { id: string } | undefined;
      if (!next) return null;
      const now = (this.deps.now ?? Date.now)();
      const changed = this.db.prepare(
        "UPDATE capability_jobs SET status = 'submission_pending', submission_attempted = 1, status_message = 'submitting_once', updated_at = ? WHERE id = ? AND status = 'queued'"
      ).run(now, next.id);
      return changed.changes === 1 ? next.id : null;
    });
    const jobId = acquire();
    if (jobId) this.emit(jobId);
    return jobId;
  }

  private async run(id: string): Promise<void> {
    let row = this.getRow(id);
    if (!row || row.status === 'canceled' || row.status === 'tracking_stopped') return;
    try {
      if (!row.provider_task_id) {
        if (row.status !== 'submission_pending' || row.submission_attempted !== 1) return;
        const route = this.deps.resolveRoute();
        if (!route?.enabled) {
          this.updateState(id, 'blocked', 'Frozen xAI connection is unavailable',
            'route_blocked_no_fallback');
          return;
        }
        const providerTaskId = await this.createProviderTask(row, route);
        if (!providerTaskId) return;
        const now = (this.deps.now ?? Date.now)();
        this.db.prepare(`UPDATE capability_jobs
          SET status = 'submitted', provider_task_id = ?, error = NULL,
              status_message = 'provider_task_submitted', updated_at = ?
          WHERE id = ?`).run(providerTaskId, now, id);
        this.emit(id);
        row = this.getRow(id)!;
      }
      await this.trackProviderTask(row);
    } catch (error) {
      const latest = this.getRow(id);
      if (!latest || latest.status === 'tracking_stopped' || latest.status === 'canceled') return;
      if (error instanceof SafeRetryExhaustedError) {
        this.updateState(id, 'blocked', error.message, 'temporary_provider_error');
      } else {
        this.fail(id, message(error));
      }
    } finally {
      const latest = this.getRow(id);
      if (latest && ['completed', 'failed', 'canceled', 'submission_unknown'].includes(latest.status)) {
        this.schedulePump(latest.connection_id);
      }
    }
  }

  private async createProviderTask(row: CapabilityJobRow, route: XaiVideoRoute): Promise<string | null> {
    const input = parseInput(row.input);
    const body: Record<string, unknown> = { model: 'grok-imagine-video', prompt: input.prompt };
    if (input.duration !== undefined) body.duration = input.duration;
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (input.resolution) body.resolution = input.resolution;
    const fetchController = new AbortController();
    const timeoutController = new AbortController();
    const timeout = sleepTimer(
      this.deps.submissionTimeoutMs ?? 30_000,
      undefined,
      { signal: timeoutController.signal }
    ).then(() => {
      fetchController.abort();
      throw new Error('xAI video submission timed out; provider acceptance is unknown');
    });
    let response: Response;
    try {
      response = await Promise.race([
        route.fetch(`${XAI_RESPONSES_API_BASE_URL}/videos/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: fetchController.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      this.updateState(row.id, 'submission_unknown', message(error), 'submission_unknown_no_retry');
      return null;
    } finally {
      timeoutController.abort();
    }
    if (!response.ok) {
      const error = await providerHttpError(response);
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        this.updateState(row.id, 'submission_unknown', error, 'submission_unknown_no_retry');
      } else {
        this.fail(row.id, error);
      }
      return null;
    }
    const raw = await response.json().catch(() => null);
    const parsed = XaiCreateResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.updateState(row.id, 'submission_unknown', 'xAI returned no usable request_id',
        'submission_unknown_no_retry');
      return null;
    }
    return parsed.data.request_id;
  }

  private async trackProviderTask(row: CapabilityJobRow): Promise<void> {
    if (!row.provider_task_id) return;
    const route = this.deps.resolveRoute();
    if (!route) {
      this.updateState(row.id, 'blocked', 'Frozen xAI connection is unavailable',
        'reconnect_same_connection');
      return;
    }
    this.updateState(row.id, 'running', null, 'provider_processing');
    const sleep = this.deps.sleep ?? sleepTimer;
    const shouldContinue = () => {
      const latest = this.getRow(row.id);
      return Boolean(latest && latest.status !== 'tracking_stopped' && latest.status !== 'canceled');
    };
    for (;;) {
      if (!shouldContinue()) return;
      const response = await this.retrySafe(async () => {
        const result = await route.fetch(
          `${XAI_RESPONSES_API_BASE_URL}/videos/${encodeURIComponent(row.provider_task_id!)}`,
          { method: 'GET' }
        );
        if (result.status === 429 || result.status >= 500) {
          throw new Error(await providerHttpError(result));
        }
        return result;
      }, shouldContinue);
      if (!response.ok) throw new Error(await providerHttpError(response));
      const rawStatus = await response.json().catch(() => null);
      if (!shouldContinue()) return;
      const parsedStatus = XaiPollResponseSchema.safeParse(rawStatus);
      if (!parsedStatus.success) throw new Error('Invalid xAI video status response');
      if (parsedStatus.data.status === 'done') {
        const videoUrl = parsedStatus.data.video?.url.trim() ?? '';
        if (!videoUrl) throw new Error('xAI video generation returned no video URL');
        await this.materializeArtifact(row, videoUrl);
        return;
      }
      if (parsedStatus.data.status === 'failed' || parsedStatus.data.status === 'expired') {
        throw new Error(`xAI video generation ${parsedStatus.data.status}`);
      }
      if (parsedStatus.data.status !== 'pending' && parsedStatus.data.status !== 'in_progress') {
        throw new Error(`Unknown xAI video generation status: ${parsedStatus.data.status || 'missing'}`);
      }
      await sleep(this.deps.pollIntervalMs ?? 5_000);
    }
  }

  private async materializeArtifact(row: CapabilityJobRow, videoUrl: string): Promise<void> {
    this.updateState(row.id, 'downloading', null, 'downloading_provider_result');
    const shouldContinue = () => {
      const latest = this.getRow(row.id);
      return Boolean(latest && latest.status !== 'tracking_stopped' && latest.status !== 'canceled');
    };
    try {
      const downloaded = await this.retrySafe(() => this.deps.download(videoUrl), shouldContinue);
      if (!shouldContinue()) return;
      if (downloaded.bytes.length === 0) throw new Error('Downloaded generated video is empty');
      const artifactPath = await writeAtomicVideoArtifact(row.project_path, downloaded.bytes);
      if (!shouldContinue()) return;
      this.complete(row.id, [{ path: artifactPath, mimeType: downloaded.mimeType || 'video/mp4' }]);
    } catch (error) {
      const latest = this.getRow(row.id);
      if (!latest || latest.status === 'tracking_stopped' || latest.status === 'canceled') return;
      if (error instanceof SafeRetryExhaustedError) {
        this.updateState(row.id, 'blocked', error.message, 'temporary_download_error');
      } else {
        this.fail(row.id, message(error));
      }
    }
  }

  private async retrySafe<T>(
    operation: () => Promise<T>,
    shouldContinue: () => boolean = () => true
  ): Promise<T> {
    const delays = this.deps.retryDelaysMs ?? [500, 1_500, 4_000];
    const sleep = this.deps.sleep ?? sleepTimer;
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      if (!shouldContinue()) throw new TrackingStoppedError();
      try {
        return await operation();
      } catch (error) {
        if (error instanceof TrackingStoppedError) throw error;
        lastError = error;
        if (attempt === delays.length) break;
        await sleep(delays[attempt]);
      }
    }
    throw new SafeRetryExhaustedError(message(lastError));
  }

  private transitionCommand(
    projectId: string,
    jobId: string,
    allowed: CapabilityJobStatus[],
    status: CapabilityJobStatus,
    statusMessage: CapabilityJobStatusMessage | null
  ): CapabilityJobCommandResult {
    const row = this.findProjectRow(projectId, jobId);
    if (!row || !allowed.includes(row.status)) {
      return { ok: false, error: `Job cannot transition to ${status}`, code: 'INVALID_STATE' };
    }
    this.updateState(jobId, status, null, statusMessage);
    if (status === 'canceled') this.schedulePump(row.connection_id);
    return { ok: true, job: this.toSnapshot(this.getRow(jobId)!) };
  }

  private findProjectRow(projectId: string, jobId: string): CapabilityJobRow | undefined {
    return this.db.prepare(
      'SELECT * FROM capability_jobs WHERE project_id = ? AND id = ?'
    ).get(projectId, jobId) as CapabilityJobRow | undefined;
  }

  private getRow(id: string): CapabilityJobRow | undefined {
    return this.db.prepare('SELECT * FROM capability_jobs WHERE id = ?').get(id) as CapabilityJobRow | undefined;
  }

  private updateState(
    id: string,
    status: CapabilityJobStatus,
    error: string | null,
    statusMessage: CapabilityJobStatusMessage | null
  ): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`UPDATE capability_jobs
      SET status = ?, error = ?, status_message = ?, updated_at = ? WHERE id = ?`)
      .run(status, error, statusMessage, now, id);
    this.emit(id);
  }

  private complete(id: string, artifacts: CapabilityJobArtifact[]): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`UPDATE capability_jobs
      SET status = 'completed', artifacts = ?, error = NULL,
          status_message = 'artifact_durable', updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(artifacts), now, id);
    this.recordTerminal(id);
    this.emit(id);
  }

  private fail(id: string, error: string): void {
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`UPDATE capability_jobs
      SET status = 'failed', error = ?, status_message = 'job_failed', updated_at = ? WHERE id = ?`)
      .run(error, now, id);
    this.recordTerminal(id);
    this.emit(id);
  }

  private recordTerminal(id: string): void {
    const row = this.getRow(id);
    if (!row) return;
    try {
      this.deps.recordTerminal?.(this.toSnapshot(row));
    } catch {
      // Conversation projection is best-effort and cannot alter the durable Job result.
    }
  }

  private emit(id: string): void {
    const row = this.getRow(id);
    if (row) this.deps.emit?.({ projectId: row.project_id, job: this.toSnapshot(row) });
  }

  private toSnapshot(row: CapabilityJobRow): CapabilityJobSnapshot {
    let artifacts: CapabilityJobArtifact[] = [];
    try { artifacts = JSON.parse(row.artifacts ?? '[]') as CapabilityJobArtifact[]; } catch { artifacts = []; }
    return {
      id: row.id,
      sourceSessionId: row.source_session_id ?? undefined,
      projectId: row.project_id,
      type: row.type,
      status: row.status,
      provider: row.provider,
      connectionId: row.connection_id,
      queuePosition: row.status === 'queued' ? this.queuePosition(row) : null,
      relatedJobId: row.related_job_id,
      availableActions: availableActions(row),
      artifacts,
      error: row.error,
      statusMessage: row.status_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private queuePosition(row: CapabilityJobRow): number {
    const result = this.db.prepare(`SELECT COUNT(*) AS count FROM capability_jobs
      WHERE connection_id = ? AND status = 'queued'
        AND rowid <= (SELECT rowid FROM capability_jobs WHERE id = ?)`)
      .get(row.connection_id, row.id) as { count: number };
    return result.count;
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
class TrackingStoppedError extends Error {}

class SafeRetryExhaustedError extends Error {}

function availableActions(row: CapabilityJobRow): CapabilityJobAction[] {
  if (row.status === 'queued' || (row.status === 'blocked' && !row.provider_task_id)) return ['cancel'];
  if (row.status === 'blocked' && row.provider_task_id) return ['resume_tracking', 'stop_tracking'];
  if (['submitted', 'running', 'downloading'].includes(row.status) && row.provider_task_id) {
    return ['stop_tracking'];
  }
  if (row.status === 'tracking_stopped') return ['resume_tracking'];
  if (row.status === 'submission_unknown') return ['resubmit'];
  return [];
}

function parseInput(raw: string): GenerateVideoInput & { prompt: string } {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('prompt' in parsed) || typeof parsed.prompt !== 'string') {
    throw new Error('Persisted video Job input is invalid');
  }
  return parsed as GenerateVideoInput & { prompt: string };
}

async function providerHttpError(response: Response): Promise<string> {
  const raw = await response.text();
  return `xAI video generation failed (${response.status}): ${raw.trim().slice(0, 500) || 'unknown provider error'}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
