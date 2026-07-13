import type Database from 'better-sqlite3';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../../shared/types';
import type {
  DelegatedAgentRun,
  DelegatedAgentRunStatus,
  DelegatedTaskResult,
} from '../../shared/types';

interface DelegatedAgentRunRow extends Omit<DelegatedAgentRun, 'outcome'> {
  outcome: string | null;
}

export interface CreateDelegatedAgentRunInput {
  id: string;
  parentAgentRunId: string;
  targetAgentId: string;
  targetAgentSlug: string;
  targetAgentName: string;
  taskToolCallId: string | null;
  goal: string;
  createdAt: number;
}

export function initializeDelegatedAgentRunSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegated_agent_runs (
      id TEXT PRIMARY KEY,
      parent_run_id TEXT NOT NULL,
      target_agent_id TEXT,
      target_agent_slug TEXT NOT NULL,
      target_agent_name TEXT NOT NULL,
      launch_form TEXT NOT NULL CHECK (launch_form = 'single'),
      task_tool_call_id TEXT,
      goal TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'completed', 'failed', 'interrupted'
      )),
      outcome TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_runs_parent_task_call
      ON delegated_agent_runs(parent_run_id, task_tool_call_id)
      WHERE task_tool_call_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_delegated_runs_parent_created
      ON delegated_agent_runs(parent_run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_delegated_runs_status
      ON delegated_agent_runs(status, created_at);
  `);
}

function parseRow(row: DelegatedAgentRunRow | undefined): DelegatedAgentRun | null {
  if (!row) return null;
  let outcome: DelegatedTaskResult | null = null;
  if (row.outcome) {
    try {
      const parsed = DELEGATED_TASK_RESULT_SCHEMA.safeParse(JSON.parse(row.outcome));
      outcome = parsed.success ? parsed.data : null;
    } catch {
      outcome = null;
    }
  }
  return { ...row, outcome };
}

export class DelegatedAgentRunRepository {
  constructor(private readonly db: Database.Database) {}

  createSingle(input: CreateDelegatedAgentRunInput): DelegatedAgentRun {
    this.db.prepare(`INSERT INTO delegated_agent_runs (
      id, parent_run_id, target_agent_id, target_agent_slug, target_agent_name,
      launch_form, task_tool_call_id, goal, status, outcome, error_code,
      error_message, created_at, started_at, ended_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'single', ?, ?, 'queued', NULL, NULL, NULL, ?, NULL, NULL, ?)`)
      .run(
        input.id,
        input.parentAgentRunId,
        input.targetAgentId,
        input.targetAgentSlug,
        input.targetAgentName,
        input.taskToolCallId,
        input.goal,
        input.createdAt,
        input.createdAt,
      );
    return this.getRequired(input.id);
  }

  get(id: string): DelegatedAgentRun | null {
    const row = this.db.prepare('SELECT * FROM delegated_agent_runs WHERE id = ?')
      .get(id) as DelegatedAgentRunRow | undefined;
    return parseRow(row);
  }

  getByTaskToolCall(parentAgentRunId: string, taskToolCallId: string): DelegatedAgentRun | null {
    const row = this.db.prepare(`SELECT * FROM delegated_agent_runs
      WHERE parent_run_id = ? AND task_tool_call_id = ?`)
      .get(parentAgentRunId, taskToolCallId) as DelegatedAgentRunRow | undefined;
    return parseRow(row);
  }

  listForConversation(sessionId: string): DelegatedAgentRun[] {
    const rows = this.db.prepare(`SELECT delegated_agent_runs.*
      FROM delegated_agent_runs
      JOIN agent_runs ON agent_runs.id = delegated_agent_runs.parent_run_id
      WHERE agent_runs.session_id = ?
      ORDER BY delegated_agent_runs.created_at ASC`)
      .all(sessionId) as DelegatedAgentRunRow[];
    return rows.map((row) => parseRow(row)).filter((row): row is DelegatedAgentRun => row !== null);
  }

  markRunning(id: string, startedAt: number): DelegatedAgentRun {
    this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE id = ? AND status = 'queued'`)
      .run(startedAt, startedAt, id);
    return this.getRequired(id);
  }

  finish(
    id: string,
    status: Extract<DelegatedAgentRunStatus, 'completed' | 'failed'>,
    outcome: DelegatedTaskResult,
    endedAt: number,
  ): DelegatedAgentRun {
    const error = outcome.status === 'failure' ? outcome.error : undefined;
    this.db.prepare(`UPDATE delegated_agent_runs
      SET status = ?, outcome = ?, error_code = ?, error_message = ?, ended_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`)
      .run(
        status,
        JSON.stringify(outcome),
        error?.code ?? null,
        error?.message ?? null,
        endedAt,
        endedAt,
        id,
      );
    return this.getRequired(id);
  }

  reconcileInterrupted(endedAt: number): number {
    const outcome: DelegatedTaskResult = {
      status: 'failure',
      artifacts: [],
      summary: '',
      error: {
        code: 'INTERRUPTED',
        message: 'Application stopped before the delegated Agent Run completed',
      },
    };
    return this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'interrupted', outcome = ?, error_code = 'INTERRUPTED',
          error_message = ?, ended_at = COALESCE(ended_at, ?), updated_at = ?
      WHERE status IN ('queued', 'running')`)
      .run(
        JSON.stringify(outcome),
        outcome.error?.message ?? null,
        endedAt,
        endedAt,
      ).changes;
  }

  private getRequired(id: string): DelegatedAgentRun {
    const row = this.get(id);
    if (!row) throw new Error(`Delegated Agent Run not found: ${id}`);
    return row;
  }
}
