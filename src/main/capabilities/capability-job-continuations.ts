import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import log from '../logger';
import {
  CapabilityJobArtifactSchema,
  CapabilityJobTimelineEventSchema,
} from '../../shared/capability-jobs';
import type {
  CapabilityJobContinuationStatus,
  CapabilityJobProvider,
  CapabilityJobSnapshot,
  CapabilityJobTimelineEvent,
} from '../../shared/capability-jobs';

const CompletionPayloadSchema = CapabilityJobTimelineEventSchema.omit({ type: true });


function parseCompletionPayload(raw: string): CapabilityJobCompletionPayload | null {
  try {
    return CompletionPayloadSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
export type CapabilityJobCompletionPayload = Omit<CapabilityJobTimelineEvent, 'type'>;

export interface CapabilityJobContinuationBatch {
  batchId: string;
  projectId: string;
  sessionId: string;
  agentId: string | null;
  eventIds: string[];
  events: CapabilityJobCompletionPayload[];
}

export interface CapabilityJobContinuationState {
  jobId: string;
  projectId: string;
  sessionId: string;
  status: CapabilityJobContinuationStatus;
  attemptCount: number;
  error: string | null;
}

interface CompletionEventRow {
  id: string;
  job_id: string;
  project_id: string;
  session_id: string;
  payload: string;
  status: CapabilityJobContinuationStatus;
  attempt_count: number;
  batch_id: string | null;
  last_error: string | null;
}

interface ContinuationDeps {
  runContinuation: (batch: CapabilityJobContinuationBatch) => Promise<void>;
  schedule?: (task: () => void, delayMs?: number) => void;
  now?: () => number;
  retryDelayMs?: number;
  onStateChanged?: (projectId: string, jobId: string) => void;
  onTimelineChanged?: (sessionId: string) => void;
}

export function initializeCapabilityJobContinuationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_job_completion_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      batch_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS capability_job_continuation_batches (
      batch_id TEXT PRIMARY KEY,
      completed_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS capability_completion_delete_session
      AFTER DELETE ON sessions
      BEGIN
        DELETE FROM capability_job_completion_events WHERE session_id = OLD.id;
      END;
    CREATE TRIGGER IF NOT EXISTS capability_completion_delete_project
      AFTER DELETE ON projects
      BEGIN
        DELETE FROM capability_job_completion_events WHERE project_id = OLD.id;
      END;
    CREATE INDEX IF NOT EXISTS idx_capability_completion_session_status
      ON capability_job_completion_events(session_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_capability_completion_project
      ON capability_job_completion_events(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_active_session
      ON agent_runs(session_id) WHERE status IN ('running', 'waiting_approval');
  `);
}

export class CapabilityJobContinuationCoordinator {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Database.Database,
    private readonly deps: ContinuationDeps
  ) {
    initializeCapabilityJobContinuationSchema(db);
  }

  enqueue(job: CapabilityJobSnapshot): void {
    if (!job.sourceSessionId || (job.status !== 'completed' && job.status !== 'failed')) return;
    const session = this.db.prepare(
      'SELECT id FROM sessions WHERE id = ? AND project_id = ?'
    ).get(job.sourceSessionId, job.projectId);
    if (!session) return;
    const eventId = `capability-job:${job.id}:terminal`;
    const payload: CapabilityJobCompletionPayload = {
      eventId,
      jobId: job.id,
      projectId: job.projectId,
      sessionId: job.sourceSessionId,
      status: job.status,
      provider: job.provider,
      mode: job.inputSummary?.mode ?? 'text',
      artifacts: job.artifacts,
      error: job.error,
    };
    const now = (this.deps.now ?? Date.now)();
    const inserted = this.db.transaction(() => {
      const result = this.db.prepare(`INSERT OR IGNORE INTO capability_job_completion_events
        (id, job_id, project_id, session_id, payload, status, attempt_count,
         batch_id, last_error, created_at, started_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, NULL, NULL)`)
        .run(eventId, job.id, job.projectId, job.sourceSessionId, JSON.stringify(payload), now);
      if (result.changes !== 1) return false;
      this.db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, 'assistant', ?, ?)`)
        .run(eventId, job.sourceSessionId, JSON.stringify({
          type: 'capability_job_event',
          ...payload,
        }), now);
      return true;
    })();
    if (!inserted) return;
    this.deps.onStateChanged?.(job.projectId, job.id);
    this.deps.onTimelineChanged?.(job.sourceSessionId);
    this.scheduleSession(job.sourceSessionId);
  }


  resumePending(): void {
    const missing = this.db.prepare(`SELECT j.id, j.project_id, j.source_session_id,
        j.status, j.provider, j.connection_id, j.input, j.artifacts, j.error, j.created_at, j.updated_at
      FROM capability_jobs j
      LEFT JOIN capability_job_completion_events e ON e.job_id = j.id
      WHERE j.status IN ('completed', 'failed')
        AND j.source_session_id IS NOT NULL
        AND e.id IS NULL`).all() as Array<{
          id: string;
          project_id: string;
          source_session_id: string;
          status: 'completed' | 'failed';
          provider: CapabilityJobProvider;
          connection_id: CapabilityJobProvider;
          input: string;
          artifacts: string | null;
          error: string | null;
          created_at: number;
          updated_at: number;
        }>;
    for (const row of missing) {
      let rawArtifacts: unknown = [];
      try {
        rawArtifacts = row.artifacts ? JSON.parse(row.artifacts) : [];
      } catch {
        rawArtifacts = [];
      }
      const artifacts = CapabilityJobArtifactSchema.array().safeParse(rawArtifacts);
      this.enqueue({
        id: row.id,
        sourceSessionId: row.source_session_id,
        projectId: row.project_id,
        type: 'video.generate',
        status: row.status,
        provider: row.provider,
        connectionId: row.connection_id,
        queuePosition: null,
        relatedJobId: null,
        availableActions: [],
        artifacts: artifacts.success ? artifacts.data : [],
        inputSummary: { mode: persistedVideoMode(row.input) },
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        terminalAt: row.updated_at,
        detailsPruned: false,
        prunedAt: null,
        statusMessage: row.status === 'completed' ? 'artifact_durable' : 'job_failed',
        continuationStatus: null,
        continuationError: null,
      });
    }
    const now = (this.deps.now ?? Date.now)();
    this.db.prepare(`UPDATE capability_job_completion_events
      SET status = 'consumed', consumed_at = ?, last_error = NULL
      WHERE status = 'running' AND EXISTS (
        SELECT 1 FROM capability_job_continuation_batches
        WHERE batch_id = capability_job_completion_events.batch_id
      )`).run(now);
    this.db.prepare(`UPDATE capability_job_completion_events
      SET status = 'failed', last_error = COALESCE(last_error, 'Application stopped during continuation')
      WHERE status = 'running'`).run();
    const rows = this.db.prepare(`SELECT DISTINCT session_id
      FROM capability_job_completion_events
      WHERE status IN ('pending', 'failed')`).all() as Array<{ session_id: string }>;
    for (const row of rows) this.scheduleSession(row.session_id);
  }
  notifyConversationIdle(sessionId: string): void {
    this.scheduleSession(sessionId);
  }

  listProjectStates(projectId: string): CapabilityJobContinuationState[] {
    const rows = this.db.prepare(`SELECT job_id, project_id, session_id, status,
      attempt_count, last_error FROM capability_job_completion_events
      WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as Array<{
        job_id: string;
        project_id: string;
        session_id: string;
        status: CapabilityJobContinuationStatus;
        attempt_count: number;
        last_error: string | null;
      }>;
    return rows.map((row) => ({
      jobId: row.job_id,
      projectId: row.project_id,
      sessionId: row.session_id,
      status: row.status,
      attemptCount: row.attempt_count,
      error: row.last_error,
    }));
  }

  stateForJob(jobId: string): { status: CapabilityJobContinuationStatus; error: string | null } | null {
    const row = this.db.prepare(
      'SELECT status, last_error FROM capability_job_completion_events WHERE job_id = ?'
    ).get(jobId) as { status: CapabilityJobContinuationStatus; last_error: string | null } | undefined;
    return row ? { status: row.status, error: row.last_error } : null;
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.running.values()]);
  }

  private scheduleSession(sessionId: string, delayMs = 0): void {
    (this.deps.schedule ?? ((task, delay) => setTimeout(task, delay)))(
      () => this.startSession(sessionId),
      delayMs
    );
  }

  private startSession(sessionId: string): void {
    if (this.running.has(sessionId)) return;
    const task = this.processSession(sessionId)
      .catch((error) => {
        log.error('[capability-job-continuation] Session processing failed:', error);
        this.scheduleSession(sessionId, this.deps.retryDelayMs ?? 5_000);
      })
      .finally(() => this.running.delete(sessionId));
    this.running.set(sessionId, task);
  }

  private async processSession(sessionId: string): Promise<void> {
    if (this.isConversationBusy(sessionId)) return;
    const batch = this.claimBatch(sessionId);
    if (!batch) return;
    this.notifyBatchState(batch);
    try {
      await this.deps.runContinuation(batch);
      const now = (this.deps.now ?? Date.now)();
      this.db.prepare(`UPDATE capability_job_completion_events
        SET status = 'consumed', consumed_at = ?, last_error = NULL
        WHERE batch_id = ? AND status = 'running'`).run(now, batch.batchId);
    } catch (error) {
      this.db.prepare(`UPDATE capability_job_completion_events
        SET status = 'failed', last_error = ?
        WHERE batch_id = ? AND status = 'running'`)
        .run(error instanceof Error ? error.message : String(error), batch.batchId);
    }
    this.notifyBatchState(batch);
    const failed = this.db.prepare(`SELECT 1 FROM capability_job_completion_events
      WHERE session_id = ? AND status = 'failed'
        AND (last_error IS NULL OR last_error NOT LIKE 'Invalid persisted completion event:%')
      LIMIT 1`).get(sessionId);
    if (failed) {
      this.scheduleSession(sessionId, this.deps.retryDelayMs ?? 5_000);
      return;
    }
    const pending = this.db.prepare(
      "SELECT 1 FROM capability_job_completion_events WHERE session_id = ? AND status = 'pending' LIMIT 1"
    ).get(sessionId);
    if (pending) this.scheduleSession(sessionId);
  }

  private isConversationBusy(sessionId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM agent_runs
      WHERE session_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1`).get(sessionId));
  }

  private claimBatch(sessionId: string): CapabilityJobContinuationBatch | null {
    return this.db.transaction(() => {
      if (this.isConversationBusy(sessionId)) return null;
      const session = this.db.prepare(
        'SELECT project_id, agent_id FROM sessions WHERE id = ?'
      ).get(sessionId) as { project_id: string; agent_id: string | null } | undefined;
      if (!session) return null;
      const retry = this.db.prepare(`SELECT batch_id FROM capability_job_completion_events
        WHERE session_id = ? AND status = 'failed'
          AND (last_error IS NULL OR last_error NOT LIKE 'Invalid persisted completion event:%')
        ORDER BY created_at, id LIMIT 1`).get(sessionId) as { batch_id: string | null } | undefined;
      const batchId = retry?.batch_id ?? crypto.randomUUID();
      const rows = (retry
        ? this.db.prepare(`SELECT * FROM capability_job_completion_events
            WHERE session_id = ? AND status = 'failed' AND batch_id = ?
            ORDER BY created_at, id`).all(sessionId, batchId)
        : this.db.prepare(`SELECT * FROM capability_job_completion_events
            WHERE session_id = ? AND status = 'pending'
            ORDER BY created_at, id`).all(sessionId)) as CompletionEventRow[];
      if (rows.length === 0) return null;
      const decoded: Array<{ row: CompletionEventRow; event: CapabilityJobCompletionPayload }> = [];
      const rejectInvalid = this.db.prepare(`UPDATE capability_job_completion_events
        SET status = 'failed', last_error = 'Invalid persisted completion event: payload'
        WHERE id = ?`);
      for (const row of rows) {
        const event = parseCompletionPayload(row.payload);
        if (event) decoded.push({ row, event });
        else rejectInvalid.run(row.id);
      }
      if (decoded.length === 0) return null;
      const now = (this.deps.now ?? Date.now)();
      const update = this.db.prepare(`UPDATE capability_job_completion_events
        SET status = 'running', batch_id = ?, started_at = ?,
            attempt_count = attempt_count + 1, last_error = NULL
        WHERE id = ? AND status IN ('pending', 'failed')`);
      const claimed = decoded.filter(({ row }) => update.run(batchId, now, row.id).changes === 1);
      if (claimed.length === 0) return null;
      return {
        batchId,
        projectId: session.project_id,
        sessionId,
        agentId: session.agent_id,
        eventIds: claimed.map(({ row }) => row.id),
        events: claimed.map(({ event }) => event),
      };
    })();
  }

  private notifyBatchState(batch: CapabilityJobContinuationBatch): void {
    for (const event of batch.events) this.deps.onStateChanged?.(batch.projectId, event.jobId);
  }

}

function persistedVideoMode(raw: string): 'text' | 'first-frame' {
  try {
    const parsed = JSON.parse(raw) as { mode?: unknown };
    return parsed.mode === 'first-frame' ? 'first-frame' : 'text';
  } catch {
    return 'text';
  }
}
