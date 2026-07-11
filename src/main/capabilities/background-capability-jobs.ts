import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  CapabilityJobAction,
  CapabilityJobArtifact,
  CapabilityJobContinuationStatus,
  CapabilityJobCommandResult,
  CapabilityJobEvent,
  CapabilityJobProvider,
  CapabilityJobSnapshot,
  CapabilityJobStatusMessage,
  CapabilityJobStatus,
  CapabilityJobSubmissionResult,
} from '../../shared/capability-jobs';
import { XAI_RESPONSES_API_BASE_URL } from '../ai-subscription-runtime';

const MINIMAX_API_BASE_URL = 'https://api.minimaxi.com/v1';
const MINIMAX_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';
const XaiCreateResponseSchema = z.object({ request_id: z.string().trim().min(1) });
const XaiPollResponseSchema = z.object({
  status: z.string(),
  video: z.object({ url: z.string() }).optional(),
});
const MiniMaxBaseResponseSchema = z.object({
  status_code: z.number(),
  status_msg: z.string().optional(),
});
const MiniMaxBaseEnvelopeSchema = z.object({ base_resp: MiniMaxBaseResponseSchema });
const MiniMaxCreateResponseSchema = z.object({
  task_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1)),
  base_resp: MiniMaxBaseResponseSchema,
});
const MiniMaxPollResponseSchema = z.object({
  status: z.string(),
  file_id: z.union([z.string(), z.number()]).transform(String).optional(),
  base_resp: MiniMaxBaseResponseSchema,
});
const MiniMaxFileResponseSchema = z.object({
  file: z.object({ download_url: z.string() }).optional(),
  base_resp: MiniMaxBaseResponseSchema,
});

interface CapabilityJobRow {
  id: string;
  project_id: string;
  project_path: string;
  type: 'video.generate';
  status: CapabilityJobStatus;
  input: string;
  provider: CapabilityJobProvider;
  connection_id: CapabilityJobProvider;
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

export interface BackgroundGenerateVideoInput {
  prompt: string;
  route_hint?: 'auto' | CapabilityJobProvider;
  duration?: number;
  aspect_ratio?: string;
  resolution?: '480p' | '720p' | '768P' | '1080P';
}

export function createMiniMaxAuthenticatedFetch(
  subscriptionKey: string,
  fetchImpl: typeof fetch
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${subscriptionKey}`);
    return fetchImpl(input, { ...init, headers });
  };
}

export interface VideoProviderRoute {
  /** Optional only for compatibility with isolated xAI lifecycle tests. */
  id?: CapabilityJobProvider;
  enabled: boolean;
  fetch: typeof fetch;
}

export interface CapabilityJobServiceDeps {
  resolveProject: (projectPath: string) => { id: string; path: string } | null;
  resolveRoute: (connectionId?: CapabilityJobProvider) => VideoProviderRoute | null;
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
    input: BackgroundGenerateVideoInput,
    projectPath?: string,
    sourceSessionId?: string
  ): Promise<CapabilityJobSubmissionResult> {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt is required', code: 'INVALID_INPUT' };
    if (
      input.route_hint
      && input.route_hint !== 'auto'
      && input.route_hint !== 'xai-oauth'
      && input.route_hint !== 'minimax-token-plan'
    ) {
      return { ok: false, error: `Unsupported video route: ${input.route_hint}`, code: 'ROUTE_UNAVAILABLE' };
    }
    const project = this.deps.resolveProject(projectPath ?? '');
    if (!project) return { ok: false, error: 'Project not found', code: 'PROJECT_NOT_FOUND' };
    const requestedRoute = input.route_hint && input.route_hint !== 'auto' ? input.route_hint : undefined;
    const route = this.deps.resolveRoute(requestedRoute);
    const connectionId = route?.id ?? requestedRoute ?? 'xai-oauth';
    if (!route || (requestedRoute && connectionId !== requestedRoute)) {
      return {
        ok: false,
        error: `${videoProviderName(requestedRoute)} is not connected for video generation`,
        code: 'ROUTE_UNAVAILABLE',
      };
    }
    if (!route.enabled) {
      return {
        ok: false,
        error: `${videoProviderName(connectionId)} video generation is disabled`,
        code: 'CAPABILITY_DISABLED',
      };
    }
    const normalizedInput = normalizeVideoInput(input, connectionId);
    if (!normalizedInput.ok) return normalizedInput;

    const id = crypto.randomUUID();
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`INSERT INTO capability_jobs
      (id, project_id, project_path, type, status, input, provider, connection_id,
       provider_task_id, source_session_id, related_job_id, artifacts, error,
       status_message, submission_attempted, created_at, updated_at)
      VALUES (?, ?, ?, 'video.generate', 'queued', ?, ?, ?,
       NULL, ?, NULL, '[]', NULL, 'waiting_connection_slot', 0, ?, ?)`)
      .run(id, project.id, project.path, JSON.stringify(normalizedInput.input),
        connectionId, connectionId, sourceSessionId ?? null, now, now);
    this.emit(id);
    this.schedulePump(connectionId);
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
    this.schedulePump('minimax-token-plan');
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  private schedulePump(connectionId: CapabilityJobProvider): void {
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


  private acquireQueuedSlot(connectionId: CapabilityJobProvider): string | null {
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
        const route = this.deps.resolveRoute(row.connection_id);
        if (!route?.enabled || (route.id && route.id !== row.connection_id)) {
          this.updateState(id, 'blocked',
            `Frozen ${videoProviderName(row.connection_id)} connection is unavailable`,
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

  private async createProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute
  ): Promise<string | null> {
    return row.provider === 'minimax-token-plan'
      ? this.createMiniMaxProviderTask(row, route)
      : this.createXaiProviderTask(row, route);
  }

  private async createXaiProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute
  ): Promise<string | null> {
    const input = parseInput(row.input);
    const body: Record<string, unknown> = { model: 'grok-imagine-video', prompt: input.prompt };
    if (input.duration !== undefined) body.duration = input.duration;
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (input.resolution) body.resolution = input.resolution;
    const response = await this.submitProviderTask(
      row,
      route,
      `${XAI_RESPONSES_API_BASE_URL}/videos/generations`,
      body
    );
    if (!response) return null;
    const raw = await response.json().catch(() => null);
    const parsed = XaiCreateResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.updateState(row.id, 'submission_unknown', 'xAI returned no usable request_id',
        'submission_unknown_no_retry');
      return null;
    }
    return parsed.data.request_id;
  }

  private async createMiniMaxProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute
  ): Promise<string | null> {
    const input = parseInput(row.input);
    const response = await this.submitProviderTask(
      row,
      route,
      `${MINIMAX_API_BASE_URL}/video_generation`,
      {
        model: MINIMAX_VIDEO_MODEL,
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution,
      }
    );
    if (!response) return null;
    const raw = await response.json().catch(() => null);
    const envelope = MiniMaxBaseEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      this.updateState(row.id, 'submission_unknown',
        'MiniMax video creation returned an invalid response or no usable task_id',
        'submission_unknown_no_retry');
      return null;
    }
    const baseError = miniMaxBaseResponseError(envelope.data.base_resp, 'video creation');
    if (baseError) {
      this.fail(row.id, baseError);
      return null;
    }
    const parsed = MiniMaxCreateResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.updateState(row.id, 'submission_unknown',
        'MiniMax video creation returned an invalid response or no usable task_id',
        'submission_unknown_no_retry');
      return null;
    }
    return parsed.data.task_id;
  }

  private async submitProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute,
    url: string,
    body: Record<string, unknown>
  ): Promise<Response | null> {
    const fetchController = new AbortController();
    const timeoutController = new AbortController();
    const providerName = videoProviderName(row.provider);
    const timeout = sleepTimer(
      this.deps.submissionTimeoutMs ?? 30_000,
      undefined,
      { signal: timeoutController.signal }
    ).then(() => {
      fetchController.abort();
      throw new Error(`${providerName} video submission timed out; provider acceptance is unknown`);
    });
    let response: Response;
    try {
      response = await Promise.race([
        route.fetch(url, {
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
      const error = await providerHttpError(response, row.provider);
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        this.updateState(row.id, 'submission_unknown', error, 'submission_unknown_no_retry');
      } else {
        this.fail(row.id, error);
      }
      return null;
    }
    return response;
  }

  private async trackProviderTask(row: CapabilityJobRow): Promise<void> {
    if (!row.provider_task_id) return;
    const route = this.deps.resolveRoute(row.connection_id);
    if (!route || (route.id && route.id !== row.connection_id)) {
      this.updateState(row.id, 'blocked',
        `Frozen ${videoProviderName(row.connection_id)} connection is unavailable`,
        'reconnect_same_connection');
      return;
    }
    if (row.provider === 'minimax-token-plan') {
      await this.trackMiniMaxProviderTask(row, route);
      return;
    }
    await this.trackXaiProviderTask(row, route);
  }

  private async trackXaiProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute
  ): Promise<void> {
    this.updateState(row.id, 'running', null, 'provider_processing');
    const sleep = this.deps.sleep ?? sleepTimer;
    const shouldContinue = () => this.shouldContinue(row.id);
    for (;;) {
      if (!shouldContinue()) return;
      const response = await this.safeProviderFetch(
        route,
        `${XAI_RESPONSES_API_BASE_URL}/videos/${encodeURIComponent(row.provider_task_id!)}`,
        row.provider,
        shouldContinue
      );
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

  private async trackMiniMaxProviderTask(
    row: CapabilityJobRow,
    route: VideoProviderRoute
  ): Promise<void> {
    const sleep = this.deps.sleep ?? sleepTimer;
    const shouldContinue = () => this.shouldContinue(row.id);
    for (;;) {
      if (!shouldContinue()) return;
      const taskId = encodeURIComponent(row.provider_task_id!);
      const response = await this.safeProviderFetch(
        route,
        `${MINIMAX_API_BASE_URL}/query/video_generation?task_id=${taskId}`,
        row.provider,
        shouldContinue
      );
      const rawStatus = await response.json().catch(() => null);
      if (!shouldContinue()) return;
      const envelope = MiniMaxBaseEnvelopeSchema.safeParse(rawStatus);
      if (!envelope.success) throw new Error('Invalid MiniMax video status response');
      const baseError = miniMaxBaseResponseError(envelope.data.base_resp, 'video status query');
      if (baseError) throw new Error(baseError);
      const parsedStatus = MiniMaxPollResponseSchema.safeParse(rawStatus);
      if (!parsedStatus.success) throw new Error('Invalid MiniMax video status response');
      const status = parsedStatus.data.status;
      if (status === 'Success') {
        const fileId = parsedStatus.data.file_id?.trim() ?? '';
        if (!fileId) throw new Error('MiniMax video success response returned no file_id');
        const fileResponse = await this.safeProviderFetch(
          route,
          `${MINIMAX_API_BASE_URL}/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
          row.provider,
          shouldContinue
        );
        const rawFile = await fileResponse.json().catch(() => null);
        if (!shouldContinue()) return;
        const parsedFile = MiniMaxFileResponseSchema.safeParse(rawFile);
        if (!parsedFile.success) throw new Error('Invalid MiniMax file retrieval response');
        const fileBaseError = miniMaxBaseResponseError(parsedFile.data.base_resp, 'file retrieval');
        if (fileBaseError) throw new Error(fileBaseError);
        const downloadUrl = parsedFile.data.file?.download_url.trim() ?? '';
        if (!downloadUrl) throw new Error('MiniMax file retrieval returned no download_url');
        await this.materializeArtifact(row, downloadUrl);
        return;
      }
      if (status === 'Fail') throw new Error('MiniMax video generation failed');
      const statusMessage = miniMaxProgressMessage(status);
      if (!statusMessage) throw new Error(`Unknown MiniMax video generation status: ${status || 'missing'}`);
      this.updateState(row.id, 'running', null, statusMessage);
      await sleep(this.deps.pollIntervalMs ?? 5_000);
    }
  }

  private async safeProviderFetch(
    route: VideoProviderRoute,
    url: string,
    provider: CapabilityJobProvider,
    shouldContinue: () => boolean
  ): Promise<Response> {
    const response = await this.retrySafe(async () => {
      const result = await route.fetch(url, { method: 'GET' });
      if (result.status === 429 || result.status >= 500) {
        throw new Error(await providerHttpError(result, provider));
      }
      return result;
    }, shouldContinue);
    if (!response.ok) throw new Error(await providerHttpError(response, provider));
    return response;
  }

  private shouldContinue(jobId: string): boolean {
    const latest = this.getRow(jobId);
    return Boolean(latest && latest.status !== 'tracking_stopped' && latest.status !== 'canceled');
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
    let continuation: { status: CapabilityJobContinuationStatus; error: string | null } | null = null;
    try {
      const event = this.db.prepare(`SELECT status, last_error
        FROM capability_job_completion_events WHERE job_id = ?`).get(row.id) as
        | { status: CapabilityJobContinuationStatus; last_error: string | null }
        | undefined;
      if (event) continuation = { status: event.status, error: event.last_error };
    } catch {
      // The continuation schema is initialized separately from isolated Job service tests.
    }
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
      continuationStatus: continuation?.status ?? null,
      continuationError: continuation?.error ?? null,
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

function normalizeVideoInput(
  input: BackgroundGenerateVideoInput,
  provider: CapabilityJobProvider
): { ok: true; input: BackgroundGenerateVideoInput & { prompt: string } }
  | { ok: false; error: string; code: string } {
  const prompt = input.prompt.trim();
  if (provider !== 'minimax-token-plan') {
    if (
      input.duration !== undefined
      && (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 15)
    ) {
      return {
        ok: false,
        error: 'xAI Grok video duration must be an integer from 1 to 15 seconds',
        code: 'INVALID_INPUT',
      };
    }
    if (input.resolution && input.resolution !== '480p' && input.resolution !== '720p') {
      return {
        ok: false,
        error: 'xAI Grok video resolution must be 480p or 720p',
        code: 'INVALID_INPUT',
      };
    }
    return { ok: true, input: { ...input, prompt, route_hint: 'xai-oauth' } };
  }
  const duration = input.duration ?? 6;
  const resolution = input.resolution ?? '768P';
  const supported = (
    (duration === 6 && (resolution === '768P' || resolution === '1080P'))
    || (duration === 10 && resolution === '768P')
  );
  if (!supported) {
    return {
      ok: false,
      error: 'MiniMax-Hailuo-2.3 supports 6s at 768P/1080P or 10s at 768P',
      code: 'INVALID_INPUT',
    };
  }
  if (input.aspect_ratio) {
    return {
      ok: false,
      error: 'MiniMax-Hailuo-2.3 does not accept aspect_ratio for this text-to-video route',
      code: 'INVALID_INPUT',
    };
  }
  return {
    ok: true,
    input: {
      prompt,
      route_hint: 'minimax-token-plan',
      duration,
      resolution,
    },
  };
}

function videoProviderName(provider?: CapabilityJobProvider): string {
  return provider === 'minimax-token-plan' ? 'MiniMax Token Plan' : 'xAI Grok OAuth';
}

function miniMaxProgressMessage(status: string): CapabilityJobStatusMessage | null {
  if (status === 'Preparing') return 'provider_preparing';
  if (status === 'Queueing') return 'provider_queueing';
  if (status === 'Processing') return 'provider_processing';
  return null;
}

function miniMaxBaseResponseError(
  response: z.infer<typeof MiniMaxBaseResponseSchema>,
  operation: string
): string | null {
  if (response.status_code === 0) return null;
  const detail = response.status_msg?.trim() || 'unknown provider error';
  const normalized = detail.toLowerCase();
  const category = response.status_code === 1004 || response.status_code === 2049
    ? 'AUTHENTICATION'
    : response.status_code === 1008
      ? 'QUOTA'
      : response.status_code === 1026 || response.status_code === 1027
        ? 'CONTENT_SAFETY'
        : response.status_code === 1002
          ? 'RATE_LIMIT'
          : /auth|api.?key|token/.test(normalized)
            ? 'AUTHENTICATION'
            : /quota|balance|insufficient|limit/.test(normalized)
              ? 'QUOTA'
              : /content|safety|sensitive|policy/.test(normalized)
                ? 'CONTENT_SAFETY'
                : 'BASE_RESPONSE';
  return `MiniMax ${operation} failed [${category}:${response.status_code}]: ${detail}`;
}

function parseInput(raw: string): BackgroundGenerateVideoInput & { prompt: string } {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('prompt' in parsed) || typeof parsed.prompt !== 'string') {
    throw new Error('Persisted video Job input is invalid');
  }
  return parsed as BackgroundGenerateVideoInput & { prompt: string };
}

async function providerHttpError(
  response: Response,
  provider: CapabilityJobProvider
): Promise<string> {
  const raw = await response.text();
  const category = response.status === 401 || response.status === 403
    ? 'AUTHENTICATION'
    : response.status === 429
      ? 'QUOTA'
      : 'PROVIDER_HTTP';
  return `${videoProviderName(provider)} video request failed [${category}:${response.status}]: ${
    raw.trim().slice(0, 500) || 'unknown provider error'
  }`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
