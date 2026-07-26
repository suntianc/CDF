import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './delegated-agent-run-repository';
import { DelegatedToolApprovalScheduler } from './delegated-tool-approval-scheduler';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO agents (id) VALUES (?)').run('agent-child');
  db.prepare('INSERT INTO agent_runs (id, session_id) VALUES (?, ?)').run('run-parent', 'session-1');
  initializeDelegatedAgentRunSchema(db);
  return db;
}

describe('DelegatedToolApprovalScheduler.clearRun', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  function setup() {
    const db = createDatabase();
    databases.push(db);
    const runs = new DelegatedAgentRunRepository(db);
    const actions = runs.createToolActionRepository();
    const scheduler = new DelegatedToolApprovalScheduler(runs, actions, { createId: () => 'action-record-1' });
    const delegatedRun = runs.createSingle({
      id: 'delegated-1',
      parentAgentRunId: 'run-parent',
      targetAgentId: 'agent-child',
      targetAgentSlug: 'child',
      targetAgentName: 'Child',
      taskToolCallId: 'call-1',
      goal: 'do the thing',
      createdAt: 1,
    });
    return { scheduler, delegatedRun };
  }

  it('still serves an already-completed action idempotently after clearRun (#220)', async () => {
    const { scheduler } = setup();
    let executions = 0;

    const first = await scheduler.runAction({
      delegatedRunId: 'delegated-1',
      action: { id: 'act-1', name: 'read_file' },
      requiresApproval: false,
      execute: async () => {
        executions += 1;
        return 'result-payload';
      },
    });
    expect(first).toBe('result-payload');
    expect(executions).toBe(1);

    // Clearing the in-memory cache must not re-run the action nor lose the result:
    // idempotency is still served from the durable action repository.
    scheduler.clearRun('delegated-1');

    const second = await scheduler.runAction({
      delegatedRunId: 'delegated-1',
      action: { id: 'act-1', name: 'read_file' },
      requiresApproval: false,
      execute: async () => {
        executions += 1;
        return 'should-not-run';
      },
    });
    expect(second).toBe('result-payload');
    expect(executions).toBe(1);
  });
});
