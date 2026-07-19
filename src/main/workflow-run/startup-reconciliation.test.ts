import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileOrphanWorkflowRunsAtStartup } from './startup-reconciliation';

const databases: Database.Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT,
      workflow_run_status TEXT
    );
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      ended_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE workflow_stage_gates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO sessions VALUES ('session-running', 'run-running', 'running');
    INSERT INTO sessions VALUES ('session-torn-gate', NULL, 'running');
    INSERT INTO sessions VALUES ('session-gate', 'run-gate', 'running');
    INSERT INTO sessions VALUES ('session-completed', NULL, 'running');
    INSERT INTO sessions VALUES ('session-dangling', 'run-missing', 'running');
    INSERT INTO sessions VALUES ('session-wrong-owner', 'run-completed', 'running');
    INSERT INTO sessions VALUES ('session-status-only', NULL, 'running');

    INSERT INTO workflow_runs VALUES ('run-running', 'session-running', 'running', NULL, NULL, 100);
    INSERT INTO workflow_runs VALUES ('run-torn-gate', 'session-torn-gate', 'running', NULL, NULL, 100);
    INSERT INTO workflow_runs VALUES ('run-gate', 'session-gate', 'waiting_gate', NULL, NULL, 100);
    INSERT INTO workflow_runs VALUES ('run-completed', 'session-completed', 'completed', NULL, 90, 90);
    INSERT INTO workflow_stage_gates VALUES ('gate-torn', 'run-torn-gate', 'pending');
  `);
  return db;
}

describe('reconcileOrphanWorkflowRunsAtStartup', () => {
  it('aborts only non-resumable running Workflow Runs and synchronizes their Conversation status', () => {
    const db = createDatabase();

    expect(reconcileOrphanWorkflowRunsAtStartup(db, 1_000)).toEqual({ abortedRunCount: 1 });
    expect(db.prepare(`SELECT status, error, ended_at, updated_at
      FROM workflow_runs WHERE id = 'run-running'`).get()).toEqual({
      status: 'aborted',
      error: 'Application stopped before the Workflow run completed',
      ended_at: 1_000,
      updated_at: 1_000,
    });
    expect(db.prepare("SELECT workflow_run_status FROM sessions WHERE id = 'session-running'").get())
      .toEqual({ workflow_run_status: 'aborted' });

    expect(db.prepare("SELECT status, ended_at FROM workflow_runs WHERE id = 'run-torn-gate'").get())
      .toEqual({ status: 'waiting_gate', ended_at: null });
    expect(db.prepare("SELECT workflow_run_id, workflow_run_status FROM sessions WHERE id = 'session-torn-gate'").get())
      .toEqual({ workflow_run_id: 'run-torn-gate', workflow_run_status: 'waiting_gate' });

    expect(db.prepare("SELECT status, ended_at FROM workflow_runs WHERE id = 'run-gate'").get())
      .toEqual({ status: 'waiting_gate', ended_at: null });
    expect(db.prepare("SELECT workflow_run_id, workflow_run_status FROM sessions WHERE id = 'session-gate'").get())
      .toEqual({ workflow_run_id: 'run-gate', workflow_run_status: 'waiting_gate' });
    expect(db.prepare("SELECT status, ended_at FROM workflow_runs WHERE id = 'run-completed'").get())
      .toEqual({ status: 'completed', ended_at: 90 });
    expect(db.prepare("SELECT workflow_run_id, workflow_run_status FROM sessions WHERE id = 'session-completed'").get())
      .toEqual({ workflow_run_id: 'run-completed', workflow_run_status: 'completed' });

    for (const sessionId of ['session-dangling', 'session-wrong-owner', 'session-status-only']) {
      expect(db.prepare('SELECT workflow_run_id, workflow_run_status FROM sessions WHERE id = ?').get(sessionId))
        .toEqual({ workflow_run_id: null, workflow_run_status: null });
    }
  });
});
