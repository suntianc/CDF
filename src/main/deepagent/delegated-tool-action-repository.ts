import type Database from 'better-sqlite3';
import type {
  DelegatedToolActionRecord,
  DelegatedToolApprovalDecision,
  DelegatedToolApprovalStatus,
  DelegatedToolExecutionStatus,
} from '../../shared/types';

interface DelegatedToolActionRow extends Omit<
  DelegatedToolActionRecord,
  'arguments' | 'output' | 'requires_approval'
> {
  arguments: string | null;
  output: string | null;
  requires_approval: number;
}

export interface CreateDelegatedToolActionInput {
  id: string;
  delegatedRunId: string;
  parentRunId: string;
  actionId: string;
  toolName: string;
  arguments?: unknown;
  description?: string;
  sequence: number;
  requiresApproval: boolean;
  createdAt: number;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function parseRow(row: DelegatedToolActionRow | undefined): DelegatedToolActionRecord | null {
  if (!row) return null;
  return {
    ...row,
    arguments: parseJson(row.arguments),
    output: parseJson(row.output),
    requires_approval: row.requires_approval === 1,
  };
}

export function initializeDelegatedToolActionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegated_tool_actions (
      id TEXT PRIMARY KEY,
      delegated_run_id TEXT NOT NULL,
      parent_run_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      arguments TEXT,
      description TEXT,
      sequence INTEGER NOT NULL,
      requires_approval INTEGER NOT NULL,
      approval_status TEXT NOT NULL CHECK (approval_status IN (
        'not_required', 'pending', 'approved', 'rejected', 'invalidated'
      )),
      decision TEXT CHECK (decision IS NULL OR decision IN ('approve', 'reject')),
      execution_status TEXT NOT NULL CHECK (execution_status IN (
        'pending', 'running', 'success', 'error', 'rejected'
      )),
      output TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (delegated_run_id) REFERENCES delegated_agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      UNIQUE (delegated_run_id, action_id)
    );
    CREATE INDEX IF NOT EXISTS idx_delegated_tool_actions_active
      ON delegated_tool_actions(parent_run_id, approval_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_delegated_tool_actions_run_sequence
      ON delegated_tool_actions(delegated_run_id, sequence);
  `);
}

export class DelegatedToolActionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateDelegatedToolActionInput): DelegatedToolActionRecord {
    this.db.prepare(`INSERT INTO delegated_tool_actions (
      id, delegated_run_id, parent_run_id, action_id, tool_name, arguments,
      description, sequence, requires_approval, approval_status, decision,
      execution_status, output, error, created_at, decided_at, ended_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, ?, NULL, NULL, ?)`)
      .run(
        input.id,
        input.delegatedRunId,
        input.parentRunId,
        input.actionId,
        input.toolName,
        stringify(input.arguments),
        input.description ?? null,
        input.sequence,
        input.requiresApproval ? 1 : 0,
        input.requiresApproval ? 'pending' : 'not_required',
        input.createdAt,
        input.createdAt,
      );
    return this.getRequired(input.id);
  }

  get(id: string): DelegatedToolActionRecord | null {
    return parseRow(this.db.prepare('SELECT * FROM delegated_tool_actions WHERE id = ?')
      .get(id) as DelegatedToolActionRow | undefined);
  }

  getByAction(delegatedRunId: string, actionId: string): DelegatedToolActionRecord | null {
    return parseRow(this.db.prepare(`SELECT * FROM delegated_tool_actions
      WHERE delegated_run_id = ? AND action_id = ?`)
      .get(delegatedRunId, actionId) as DelegatedToolActionRow | undefined);
  }

  listForRun(delegatedRunId: string): DelegatedToolActionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM delegated_tool_actions
      WHERE delegated_run_id = ? ORDER BY sequence ASC, rowid ASC`)
      .all(delegatedRunId) as DelegatedToolActionRow[];
    return rows.map((row) => parseRow(row)).filter((row): row is DelegatedToolActionRecord => row !== null);
  }

  listForConversation(sessionId: string): DelegatedToolActionRecord[] {
    const rows = this.db.prepare(`SELECT delegated_tool_actions.*
      FROM delegated_tool_actions
      JOIN agent_runs ON agent_runs.id = delegated_tool_actions.parent_run_id
      WHERE agent_runs.session_id = ? AND delegated_tool_actions.requires_approval = 1
      ORDER BY delegated_tool_actions.created_at ASC, delegated_tool_actions.rowid ASC`)
      .all(sessionId) as DelegatedToolActionRow[];
    return rows.map((row) => parseRow(row)).filter((row): row is DelegatedToolActionRecord => row !== null);
  }

  decide(id: string, decision: DelegatedToolApprovalDecision, decidedAt: number): DelegatedToolActionRecord {
    const approvalStatus: DelegatedToolApprovalStatus = decision === 'approve' ? 'approved' : 'rejected';
    const executionStatus: DelegatedToolExecutionStatus = decision === 'approve' ? 'running' : 'rejected';
    this.db.prepare(`UPDATE delegated_tool_actions
      SET approval_status = ?, decision = ?, execution_status = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND approval_status = 'pending'`)
      .run(approvalStatus, decision, executionStatus, decidedAt, decidedAt, id);
    return this.getRequired(id);
  }

  markRunning(id: string, updatedAt: number): DelegatedToolActionRecord {
    this.db.prepare(`UPDATE delegated_tool_actions
      SET execution_status = 'running', updated_at = ?
      WHERE id = ? AND execution_status = 'pending'`)
      .run(updatedAt, id);
    return this.getRequired(id);
  }

  finish(
    id: string,
    status: Extract<DelegatedToolExecutionStatus, 'success' | 'error' | 'rejected'>,
    output: unknown,
    error: string | null,
    endedAt: number,
  ): DelegatedToolActionRecord {
    this.db.prepare(`UPDATE delegated_tool_actions
      SET execution_status = ?, output = ?, error = ?, ended_at = ?, updated_at = ?
      WHERE id = ? AND execution_status IN ('pending', 'running', 'rejected')`)
      .run(status, stringify(output), error, endedAt, endedAt, id);
    return this.getRequired(id);
  }

  invalidatePending(parentRunId: string | null, updatedAt: number, error: string): number {
    const filter = parentRunId ? 'AND parent_run_id = ?' : '';
    const params = parentRunId
      ? [error, updatedAt, updatedAt, parentRunId]
      : [error, updatedAt, updatedAt];
    return this.db.prepare(`UPDATE delegated_tool_actions
      SET approval_status = 'invalidated', execution_status = 'rejected',
          error = ?, ended_at = COALESCE(ended_at, ?), updated_at = ?
      WHERE approval_status = 'pending' ${filter}`)
      .run(...params).changes;
  }

  private getRequired(id: string): DelegatedToolActionRecord {
    const row = this.get(id);
    if (!row) throw new Error(`Delegated tool action not found: ${id}`);
    return row;
  }
}
