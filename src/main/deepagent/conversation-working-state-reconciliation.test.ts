import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationWorkingStateWorkerRunner,
  reconcileOrphanConversationWorkingState,
  type ConversationWorkingStateWorker,
} from './conversation-working-state-reconciliation';

describe('reconcileOrphanConversationWorkingState', () => {
  let tempDir: string;
  let databasePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-reconcile-'));
    databasePath = path.join(tempDir, 'deepagents-checkpoints.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not create a checkpoint database when none exists', () => {
    expect(reconcileOrphanConversationWorkingState({
      checkpointDatabasePath: databasePath,
      liveThreadIds: [],
    })).toEqual({ deletedThreadCount: 0 });
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('accepts an existing database before the checkpointer tables are initialized', () => {
    const db = new Database(databasePath);
    db.close();

    expect(reconcileOrphanConversationWorkingState({
      checkpointDatabasePath: databasePath,
      liveThreadIds: [],
    })).toEqual({ deletedThreadCount: 0 });
  });

  it('removes orphan checkpoints and writes without deserializing live payloads', () => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        checkpoint BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
    const insertCheckpoint = db.prepare(
      "INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint) VALUES (?, '', ?, ?)"
    );
    insertCheckpoint.run('conversation-live', 'checkpoint-live', Buffer.alloc(2 * 1024 * 1024, 0xff));
    insertCheckpoint.run('conversation-orphan', 'checkpoint-orphan', Buffer.from([0xc3, 0x28]));
    db.prepare(`INSERT INTO writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, value)
      VALUES ('conversation-writes-only', '', 'checkpoint-write', 'task-1', 0, X'FF')`).run();
    const pageCountBefore = db.pragma('page_count', { simple: true }) as number;
    db.close();

    const result = reconcileOrphanConversationWorkingState({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live'],
    });

    expect(result).toEqual({ deletedThreadCount: 2 });
    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT DISTINCT thread_id FROM checkpoints').all()).toEqual([
      { thread_id: 'conversation-live' },
    ]);
    expect(reopened.prepare('SELECT DISTINCT thread_id FROM writes').all()).toEqual([]);
    expect(reopened.pragma('page_count', { simple: true })).toBe(pageCountBefore);
    reopened.close();
  });

  it('rolls back writes deletion when checkpoint deletion fails', () => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
      INSERT INTO checkpoints VALUES ('conversation-orphan', '', 'checkpoint-1');
      INSERT INTO writes VALUES ('conversation-orphan', '', 'checkpoint-1', 'task-1', 0);
      CREATE TRIGGER reject_checkpoint_delete
      BEFORE DELETE ON checkpoints
      BEGIN
        SELECT RAISE(ABORT, 'delete rejected');
      END;
    `);
    db.close();

    expect(() => reconcileOrphanConversationWorkingState({
      checkpointDatabasePath: databasePath,
      liveThreadIds: [],
    })).toThrow('delete rejected');

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM checkpoints').get()).toEqual({ count: 1 });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM writes').get()).toEqual({ count: 1 });
    reopened.close();
  });
});

describe('ConversationWorkingStateWorkerRunner', () => {
  class FakeWorker extends EventEmitter implements ConversationWorkingStateWorker {
    unrefCalled = false;

    unref(): void {
      this.unrefCalled = true;
    }
  }

  const request = {
    checkpointDatabasePath: '/tmp/deepagents-checkpoints.db',
    liveThreadIds: ['conversation-1'],
  };

  it('passes the reconciliation request to the Worker and returns its result', async () => {
    const worker = new FakeWorker();
    let receivedPath = '';
    let receivedRequest: unknown;
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      (workerPath, workerRequest) => {
        receivedPath = workerPath;
        receivedRequest = workerRequest;
        queueMicrotask(() => worker.emit('message', {
          ok: true,
          result: { deletedThreadCount: 2 },
        }));
        return worker;
      }
    );

    await expect(runner.run(request)).resolves.toEqual({ deletedThreadCount: 2 });
    expect(receivedPath).toBe('/app/reconciliation-worker.js');
    expect(receivedRequest).toEqual(request);
    expect(worker.unrefCalled).toBe(true);
  });

  it('rejects a structured Worker failure', async () => {
    const worker = new FakeWorker();
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      () => {
        queueMicrotask(() => worker.emit('message', { ok: false, error: 'database busy' }));
        return worker;
      }
    );

    await expect(runner.run(request)).rejects.toThrow('database busy');
  });

  it('rejects when the Worker exits before reporting a result', async () => {
    const worker = new FakeWorker();
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      () => {
        queueMicrotask(() => worker.emit('exit', 1));
        return worker;
      }
    );

    await expect(runner.run(request)).rejects.toThrow('exited with code 1');
  });
});
