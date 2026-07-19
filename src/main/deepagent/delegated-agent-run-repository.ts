import type Database from 'better-sqlite3';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../../shared/types';
import type {
  DelegatedAgentRun,
  DelegatedAgentRunStatus,
  DelegatedTaskResult,
} from '../../shared/types';
import {
  DelegatedToolActionRepository,
  initializeDelegatedToolActionSchema,
} from './delegated-tool-action-repository';

interface DelegatedAgentRunRow extends Omit<DelegatedAgentRun, 'outcome'> {
  outcome: string | null;
}

export interface CreateDelegatedAgentRunInput {
  id: string;
  parentAgentRunId: string;
  targetAgentId: string | null;
  targetAgentSlug: string;
  targetAgentName: string;
  taskToolCallId: string | null;
  batchId?: string | null;
  workflowRunTaskId?: string | null;
  goal: string;
  createdAt: number;
}

function createDelegatedAgentRunsTableSql(tableName: string): string {
  return `CREATE TABLE ${tableName} (
    id TEXT PRIMARY KEY,
    parent_run_id TEXT NOT NULL,
    target_agent_id TEXT,
    target_agent_slug TEXT NOT NULL,
    target_agent_name TEXT NOT NULL,
    launch_form TEXT NOT NULL CHECK (launch_form IN ('single', 'parallel')),
    task_tool_call_id TEXT,
    batch_id TEXT,
    workflow_run_task_id TEXT,
    goal TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'interrupted'
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
  )`;
}

function migrateDelegatedAgentRunsTable(db: Database.Database): void {
  const existing = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'delegated_agent_runs'",
  ).get() as { sql: string } | undefined;
  if (!existing || (
    existing.sql.includes("'parallel'")
    && existing.sql.includes('batch_id')
    && existing.sql.includes("'waiting_approval'")
    && existing.sql.includes("'cancelled'")
  )) {
    return;
  }

  const columns = new Set(
    (db.prepare("SELECT name FROM pragma_table_info('delegated_agent_runs')").all() as Array<{ name: string }>)
      .map(({ name }) => name),
  );
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS delegated_agent_runs_next');
      db.exec(createDelegatedAgentRunsTableSql('delegated_agent_runs_next'));
      db.exec(`INSERT INTO delegated_agent_runs_next (
        id, parent_run_id, target_agent_id, target_agent_slug, target_agent_name,
        launch_form, task_tool_call_id, batch_id, workflow_run_task_id, goal,
        status, outcome, error_code, error_message, created_at, started_at,
        ended_at, updated_at
      ) SELECT
        id, parent_run_id, target_agent_id, target_agent_slug, target_agent_name,
        launch_form, task_tool_call_id,
        ${columns.has('batch_id') ? 'batch_id' : 'NULL'},
        ${columns.has('workflow_run_task_id') ? 'workflow_run_task_id' : 'NULL'},
        goal, status, outcome, error_code, error_message, created_at, started_at,
        ended_at, updated_at
      FROM delegated_agent_runs`);
      db.exec('DROP TABLE delegated_agent_runs');
      db.exec('ALTER TABLE delegated_agent_runs_next RENAME TO delegated_agent_runs');
    })();
  } finally {
    if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
  }
}

export function initializeDelegatedAgentRunSchema(db: Database.Database): void {
  migrateDelegatedAgentRunsTable(db);
  db.exec(`
    ${createDelegatedAgentRunsTableSql('IF NOT EXISTS delegated_agent_runs')};
    CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_runs_parent_task_call
      ON delegated_agent_runs(parent_run_id, task_tool_call_id)
      WHERE task_tool_call_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_delegated_runs_parent_created
      ON delegated_agent_runs(parent_run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_delegated_runs_parent_batch
      ON delegated_agent_runs(parent_run_id, batch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_delegated_runs_status
      ON delegated_agent_runs(status, created_at);
  `);
  initializeDelegatedToolActionSchema(db);
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

  createToolActionRepository(): DelegatedToolActionRepository {
    return new DelegatedToolActionRepository(this.db);
  }

  createSingle(input: CreateDelegatedAgentRunInput): DelegatedAgentRun {
    return this.create(input, 'single');
  }

  createParallel(input: CreateDelegatedAgentRunInput & { batchId: string }): DelegatedAgentRun {
    return this.create(input, 'parallel');
  }

  private create(
    input: CreateDelegatedAgentRunInput,
    launchForm: 'single' | 'parallel',
  ): DelegatedAgentRun {
    this.db.prepare(`INSERT INTO delegated_agent_runs (
      id, parent_run_id, target_agent_id, target_agent_slug, target_agent_name,
      launch_form, task_tool_call_id, batch_id, workflow_run_task_id, goal,
      status, outcome, error_code, error_message, created_at, started_at,
      ended_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, NULL, NULL, ?)`)
      .run(
        input.id,
        input.parentAgentRunId,
        input.targetAgentId,
        input.targetAgentSlug,
        input.targetAgentName,
        launchForm,
        input.taskToolCallId,
        input.batchId ?? null,
        input.workflowRunTaskId ?? null,
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

  listByBatch(parentAgentRunId: string, batchId: string): DelegatedAgentRun[] {
    const rows = this.db.prepare(`SELECT * FROM delegated_agent_runs
      WHERE parent_run_id = ? AND batch_id = ?
      ORDER BY created_at ASC, rowid ASC`)
      .all(parentAgentRunId, batchId) as DelegatedAgentRunRow[];
    return rows.map((row) => parseRow(row)).filter((row): row is DelegatedAgentRun => row !== null);
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

  markWaitingApproval(id: string, updatedAt: number): DelegatedAgentRun {
    this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'waiting_approval', updated_at = ?
      WHERE id = ? AND status = 'running'`)
      .run(updatedAt, id);
    return this.getRequired(id);
  }

  markRunningAfterApproval(id: string, updatedAt: number): DelegatedAgentRun {
    this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'running', updated_at = ?
      WHERE id = ? AND status = 'waiting_approval'`)
      .run(updatedAt, id);
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
      WHERE id = ? AND status IN ('queued', 'running', 'waiting_approval')`)
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

  cancelForParent(parentAgentRunId: string, endedAt: number): number {
    const outcome: DelegatedTaskResult = {
      status: 'failure',
      artifacts: [],
      summary: '',
      error: { code: 'CANCELLED', message: 'Parent Agent Run was stopped by the user' },
    };
    return this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'cancelled', outcome = ?, error_code = 'CANCELLED',
          error_message = ?, ended_at = COALESCE(ended_at, ?), updated_at = ?
      WHERE parent_run_id = ? AND status IN ('queued', 'running', 'waiting_approval')`)
      .run(JSON.stringify(outcome), outcome.error?.message ?? null, endedAt, endedAt, parentAgentRunId).changes;
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
    const changes = this.db.prepare(`UPDATE delegated_agent_runs
      SET status = 'interrupted', outcome = ?, error_code = 'INTERRUPTED',
          error_message = ?, ended_at = COALESCE(ended_at, ?), updated_at = ?
      WHERE status IN ('queued', 'running', 'waiting_approval')`)
      .run(
        JSON.stringify(outcome),
        outcome.error?.message ?? null,
        endedAt,
        endedAt,
      ).changes;
    this.createToolActionRepository().invalidatePending(null, endedAt, 'Application stopped before approval was resolved');
    return changes;
  }

  private getRequired(id: string): DelegatedAgentRun {
    const row = this.get(id);
    if (!row) throw new Error(`Delegated Agent Run not found: ${id}`);
    return row;
  }
}
