import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_DELETE_ERROR_CODES,
  ConversationDeleteError,
  deleteConversation,
} from './conversation-deletion';

interface TestDatabase {
  db: Database.Database;
  deleteAttempts: () => number;
  deleteWasInsideTransaction: () => boolean | null;
}

function createDatabase(options: { withCapabilityJobs?: boolean; withDelegatedRuns?: boolean } = {}): TestDatabase {
  const db = new Database(':memory:');
  let deleteAttempts = 0;
  let deleteWasInsideTransaction: boolean | null = null;
  db.function('record_session_delete', () => {
    deleteAttempts += 1;
    deleteWasInsideTransaction = db.inTransaction;
    return 0;
  });
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TRIGGER observe_session_delete
      BEFORE DELETE ON sessions
      BEGIN
        SELECT record_session_delete();
      END;
    INSERT INTO sessions (id) VALUES ('conversation-1');
  `);
  if (options.withCapabilityJobs) {
    db.exec(`CREATE TABLE capability_jobs (
      id TEXT PRIMARY KEY,
      source_session_id TEXT,
      status TEXT NOT NULL
    )`);
  }
  if (options.withDelegatedRuns) {
    db.exec(`CREATE TABLE delegated_agent_runs (
      id TEXT PRIMARY KEY,
      parent_run_id TEXT NOT NULL,
      status TEXT NOT NULL
    )`);
  }
  return {
    db,
    deleteAttempts: () => deleteAttempts,
    deleteWasInsideTransaction: () => deleteWasInsideTransaction,
  };
}

describe('deleteConversation', () => {
  it('rejects a Conversation with a running Agent Run without executing DELETE', () => {
    const { db, deleteAttempts } = createDatabase();
    db.prepare(
      "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', 'running')"
    ).run();

    expect(() => deleteConversation(db, 'conversation-1')).toThrowError(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it('rejects a Conversation with an Agent Run waiting for approval without executing DELETE', () => {
    const { db, deleteAttempts } = createDatabase();
    db.prepare(
      "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', 'waiting_approval')"
    ).run();

    expect(() => deleteConversation(db, 'conversation-1')).toThrowError(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it.each(['completed', 'failed', 'aborted'])(
    'deletes a Conversation when its Agent Runs are %s',
    (status) => {
      const { db, deleteAttempts } = createDatabase();
      db.prepare(
        "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', ?)"
      ).run(status);

      expect(deleteConversation(db, 'conversation-1')).toBeUndefined();
      expect(deleteAttempts()).toBe(1);
    }
  );

  it('protects a Conversation while a delegated child is active and permits deletion after reconciliation', () => {
    const { db, deleteAttempts } = createDatabase({ withDelegatedRuns: true });
    db.prepare("INSERT INTO agent_runs VALUES ('run-1', 'conversation-1', 'interrupted')").run();
    db.prepare("INSERT INTO delegated_agent_runs VALUES ('child-1', 'run-1', 'waiting_approval')").run();

    expect(() => deleteConversation(db, 'conversation-1')).toThrowError(
      expect.objectContaining({ code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN }),
    );
    expect(deleteAttempts()).toBe(0);

    db.prepare("UPDATE delegated_agent_runs SET status = 'interrupted'").run();
    expect(deleteConversation(db, 'conversation-1')).toBeUndefined();
    expect(deleteAttempts()).toBe(1);
  });

  it.each([
    'queued',
    'submission_pending',
    'submission_unknown',
    'submitted',
    'running',
    'downloading',
    'blocked',
    'tracking_stopped',
  ])('rejects a Conversation with a %s Background Capability Job without executing DELETE', (status) => {
    const { db, deleteAttempts } = createDatabase({ withCapabilityJobs: true });
    db.prepare(
      "INSERT INTO capability_jobs (id, source_session_id, status) VALUES ('job-1', 'conversation-1', ?)"
    ).run(status);

    expect(() => deleteConversation(db, 'conversation-1')).toThrowError(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it.each(['completed', 'failed', 'canceled'])(
    'deletes a Conversation when its Background Capability Jobs are %s',
    (status) => {
      const { db, deleteAttempts } = createDatabase({ withCapabilityJobs: true });
      db.prepare(
        "INSERT INTO capability_jobs (id, source_session_id, status) VALUES ('job-1', 'conversation-1', ?)"
      ).run(status);

      expect(deleteConversation(db, 'conversation-1')).toBeUndefined();
      expect(deleteAttempts()).toBe(1);
      expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'conversation-1'").get()).toBeUndefined();
    }
  );

  it('checks work and deletes a Conversation atomically when no work is associated', () => {
    const { db, deleteAttempts, deleteWasInsideTransaction } = createDatabase({
      withCapabilityJobs: true,
    });

    expect(deleteConversation(db, 'conversation-1')).toBeUndefined();
    expect(deleteAttempts()).toBe(1);
    expect(deleteWasInsideTransaction()).toBe(true);
    expect(db.inTransaction).toBe(false);
  });

  it('deletes safely before the capability_jobs table has been initialized', () => {
    const { db, deleteAttempts } = createDatabase();

    expect(deleteConversation(db, 'conversation-1')).toBeUndefined();
    expect(deleteAttempts()).toBe(1);
  });
});
