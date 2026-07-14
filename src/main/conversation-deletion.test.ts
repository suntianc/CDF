import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_DELETE_ERROR_CODES,
  PROJECT_DELETE_ERROR_CODES,
  ConversationDeleteError,
  ProjectDeleteError,
  deleteConversation,
  deleteProject,
} from './conversation-deletion';
import { createConversationWorkingStateLifecycle } from './deepagent/conversation-working-state';
import { reconcileOrphanConversationWorkingState } from './deepagent/conversation-working-state-reconciliation';

function checkpoint(id: string): Checkpoint {
  return {
    v: 4,
    id,
    ts: '2026-07-13T00:00:00.000Z',
    channel_values: { messages: ['retained'] },
    channel_versions: { messages: 1 },
    versions_seen: {},
  };
}

const checkpointMetadata: CheckpointMetadata = {
  source: 'input',
  step: -1,
  parents: {},
};

const noWorkingStateCleanup = { deleteThread: async (_threadId: string) => undefined };
const testDatabases: Array<{ db: Database.Database; tempDir: string }> = [];

afterEach(() => {
  for (const { db, tempDir } of testDatabases.splice(0)) {
    if (db.open) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

interface TestDatabase {
  db: Database.Database;
  deleteAttempts: () => number;
  deleteWasInsideTransaction: () => boolean | null;
}

function createDatabase(options: { withCapabilityJobs?: boolean; withDelegatedRuns?: boolean } = {}): TestDatabase {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-business-delete-'));
  const db = new Database(path.join(tempDir, 'cdf.db'));
  testDatabases.push({ db, tempDir });
  let deleteAttempts = 0;
  let deleteWasInsideTransaction: boolean | null = null;
  db.function('record_session_delete', () => {
    deleteAttempts += 1;
    deleteWasInsideTransaction = db.inTransaction;
    return 0;
  });
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
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
    INSERT INTO projects (id) VALUES ('project-1');
    INSERT INTO sessions (id, project_id) VALUES ('conversation-1', 'project-1');
  `);
  if (options.withCapabilityJobs) {
    db.exec(`CREATE TABLE capability_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
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
  it('does not delete business or Working State records during compaction', async () => {
    const { db, deleteAttempts } = createDatabase();
    const maintenanceError = Object.assign(new Error('maintenance'), {
      code: 'CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED',
    });
    const deleteThread = vi.fn(async () => undefined);

    await expect(deleteConversation(db, 'conversation-1', {
      deleteThread,
      assertConversationDeletionAllowed: () => { throw maintenanceError; },
    })).rejects.toBe(maintenanceError);

    expect(deleteAttempts()).toBe(0);
    expect(db.prepare("SELECT id FROM sessions WHERE id = 'conversation-1'").get())
      .toEqual({ id: 'conversation-1' });
    expect(deleteThread).not.toHaveBeenCalled();
  });

  it('deletes the Conversation and its Working State after the business commit', async () => {
    const { db } = createDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-conversation-delete-'));
    const workingState = createConversationWorkingStateLifecycle(
      () => path.join(tempDir, 'deepagents-checkpoints.db')
    );
    try {
      const saver = workingState.acquireSaver();
      const savedConfig = await saver.put(
        { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
        checkpoint('checkpoint-1'),
        checkpointMetadata
      );
      await saver.putWrites(savedConfig, [['tool-result', 'payload']], 'task-1');

      await deleteConversation(db, 'conversation-1', workingState);

      expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'conversation-1'").get()).toBeUndefined();
      await expect(saver.getTuple({
        configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
      })).resolves.toBeUndefined();
    } finally {
      workingState.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a Conversation with a running Agent Run without executing DELETE', async () => {
    const { db, deleteAttempts } = createDatabase();
    db.prepare(
      "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', 'running')"
    ).run();

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it('rejects a Conversation with an Agent Run waiting for approval without executing DELETE', async () => {
    const { db, deleteAttempts } = createDatabase();
    db.prepare(
      "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', 'waiting_approval')"
    ).run();

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it.each(['completed', 'failed', 'aborted'])(
    'deletes a Conversation when its Agent Runs are %s',
    async (status) => {
      const { db, deleteAttempts } = createDatabase();
      db.prepare(
        "INSERT INTO agent_runs (id, session_id, status) VALUES ('run-1', 'conversation-1', ?)"
      ).run(status);

      await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).resolves.toBeUndefined();
      expect(deleteAttempts()).toBe(1);
    }
  );

  it('protects a Conversation while a delegated child is active and permits deletion after reconciliation', async () => {
    const { db, deleteAttempts } = createDatabase({ withDelegatedRuns: true });
    db.prepare("INSERT INTO agent_runs VALUES ('run-1', 'conversation-1', 'interrupted')").run();
    db.prepare("INSERT INTO delegated_agent_runs VALUES ('child-1', 'run-1', 'waiting_approval')").run();

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining({ code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN }),
    );
    expect(deleteAttempts()).toBe(0);

    db.prepare("UPDATE delegated_agent_runs SET status = 'interrupted'").run();
    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).resolves.toBeUndefined();
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
  ])('rejects a Conversation with a %s Background Capability Job without executing DELETE', async (status) => {
    const { db, deleteAttempts } = createDatabase({ withCapabilityJobs: true });
    db.prepare(
      "INSERT INTO capability_jobs (id, source_session_id, status) VALUES ('job-1', 'conversation-1', ?)"
    ).run(status);

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ConversationDeleteError>>({
        code: CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
        message: expect.stringContaining(CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB),
      })
    );
    expect(deleteAttempts()).toBe(0);
  });

  it.each(['completed', 'failed', 'canceled'])(
    'deletes a Conversation when its Background Capability Jobs are %s',
    async (status) => {
      const { db, deleteAttempts } = createDatabase({ withCapabilityJobs: true });
      db.prepare(
        "INSERT INTO capability_jobs (id, source_session_id, status) VALUES ('job-1', 'conversation-1', ?)"
      ).run(status);

      await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).resolves.toBeUndefined();
      expect(deleteAttempts()).toBe(1);
      expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'conversation-1'").get()).toBeUndefined();
    }
  );

  it('checks work and deletes a Conversation atomically when no work is associated', async () => {
    const { db, deleteAttempts, deleteWasInsideTransaction } = createDatabase({
      withCapabilityJobs: true,
    });

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).resolves.toBeUndefined();
    expect(deleteAttempts()).toBe(1);
    expect(deleteWasInsideTransaction()).toBe(true);
    expect(db.inTransaction).toBe(false);
  });

  it('deletes safely before the capability_jobs table has been initialized', async () => {
    const { db, deleteAttempts } = createDatabase();

    await expect(deleteConversation(db, 'conversation-1', noWorkingStateCleanup)).resolves.toBeUndefined();
    expect(deleteAttempts()).toBe(1);
  });

  it('keeps a cleanup failure recoverable after authoritative business deletion', async () => {
    const { db } = createDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-conversation-orphan-'));
    const workingState = createConversationWorkingStateLifecycle(
      () => path.join(tempDir, 'deepagents-checkpoints.db')
    );
    try {
      const saver = workingState.acquireSaver();
      await saver.put(
        { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
        checkpoint('checkpoint-orphan'),
        checkpointMetadata
      );
      const failingCleanup = {
        deleteThread: vi.fn(async () => { throw new Error('checkpoint busy'); }),
      };

      await expect(deleteConversation(db, 'conversation-1', failingCleanup)).resolves.toBeUndefined();

      expect(db.prepare("SELECT 1 FROM sessions WHERE id = 'conversation-1'").get()).toBeUndefined();
      await expect(saver.getTuple({
        configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
      })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-orphan' } });

      expect(reconcileOrphanConversationWorkingState({
        checkpointDatabasePath: path.join(tempDir, 'deepagents-checkpoints.db'),
        liveThreadIds: [],
      })).toEqual({ deletedThreadCount: 1 });
      await expect(saver.getTuple({
        configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
      })).resolves.toBeUndefined();
    } finally {
      workingState.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('deleteProject', () => {
  it('rejects the protected default Project in the authoritative deletion seam', async () => {
    const { db } = createDatabase();
    db.prepare("INSERT INTO projects (id) VALUES ('default-project')").run();

    await expect(deleteProject(db, 'default-project', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ProjectDeleteError>>({
        code: PROJECT_DELETE_ERROR_CODES.PROTECTED_PROJECT,
      })
    );
    expect(db.prepare("SELECT 1 FROM projects WHERE id = 'default-project'").get()).toBeDefined();
  });

  it('preflights every Conversation before deleting any Project data', async () => {
    const { db } = createDatabase();
    db.prepare("INSERT INTO sessions (id, project_id) VALUES ('conversation-2', 'project-1')").run();
    db.prepare("INSERT INTO agent_runs VALUES ('run-2', 'conversation-2', 'running')").run();
    const cleanup = { deleteThread: vi.fn(async () => undefined) };

    await expect(deleteProject(db, 'project-1', cleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ProjectDeleteError>>({
        code: PROJECT_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
      })
    );

    expect(db.prepare("SELECT 1 FROM projects WHERE id = 'project-1'").get()).toBeDefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE project_id = ?').get('project-1')).toEqual({ count: 2 });
    expect(cleanup.deleteThread).not.toHaveBeenCalled();
  });

  it('rejects a Project while one of its Delegated Agent Runs is active', async () => {
    const { db } = createDatabase({ withDelegatedRuns: true });
    db.prepare("INSERT INTO agent_runs VALUES ('run-1', 'conversation-1', 'interrupted')").run();
    db.prepare("INSERT INTO delegated_agent_runs VALUES ('child-1', 'run-1', 'queued')").run();

    await expect(deleteProject(db, 'project-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ProjectDeleteError>>({
        code: PROJECT_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
      })
    );
    expect(db.prepare("SELECT 1 FROM projects WHERE id = 'project-1'").get()).toBeDefined();
  });

  it('rejects a Project with a non-terminal Background Capability Job not attached to a Conversation', async () => {
    const { db } = createDatabase({ withCapabilityJobs: true });
    db.prepare(`INSERT INTO capability_jobs (id, project_id, source_session_id, status)
      VALUES ('job-1', 'project-1', NULL, 'running')`).run();

    await expect(deleteProject(db, 'project-1', noWorkingStateCleanup)).rejects.toMatchObject(
      expect.objectContaining<Partial<ProjectDeleteError>>({
        code: PROJECT_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
      })
    );
    expect(db.prepare("SELECT 1 FROM projects WHERE id = 'project-1'").get()).toBeDefined();
  });

  it('deletes every owned Working State thread and preserves unrelated Projects', async () => {
    const { db } = createDatabase({ withCapabilityJobs: true });
    db.prepare("INSERT INTO sessions (id, project_id) VALUES ('conversation-2', 'project-1')").run();
    db.prepare("INSERT INTO projects (id) VALUES ('project-2')").run();
    db.prepare("INSERT INTO sessions (id, project_id) VALUES ('conversation-other', 'project-2')").run();
    db.prepare(`INSERT INTO capability_jobs (id, project_id, source_session_id, status)
      VALUES ('job-terminal', 'project-1', 'conversation-1', 'completed')`).run();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-project-delete-'));
    const workingState = createConversationWorkingStateLifecycle(
      () => path.join(tempDir, 'deepagents-checkpoints.db')
    );
    try {
      const saver = workingState.acquireSaver();
      for (const [threadId, checkpointId] of [
        ['conversation-1', 'checkpoint-1'],
        ['conversation-2', 'checkpoint-2'],
        ['conversation-other', 'checkpoint-other'],
      ] as const) {
        await saver.put(
          { configurable: { thread_id: threadId, checkpoint_ns: '' } },
          checkpoint(checkpointId),
          checkpointMetadata
        );
      }

      await deleteProject(db, 'project-1', workingState);

      expect(db.prepare("SELECT 1 FROM projects WHERE id = 'project-1'").get()).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM projects WHERE id = 'project-2'").get()).toBeDefined();
      expect(db.prepare("SELECT 1 FROM capability_jobs WHERE id = 'job-terminal'").get()).toBeUndefined();
      for (const threadId of ['conversation-1', 'conversation-2']) {
        await expect(saver.getTuple({
          configurable: { thread_id: threadId, checkpoint_ns: '' },
        })).resolves.toBeUndefined();
      }
      await expect(saver.getTuple({
        configurable: { thread_id: 'conversation-other', checkpoint_ns: '' },
      })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-other' } });
    } finally {
      workingState.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
