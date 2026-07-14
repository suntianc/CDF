import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compactConversationWorkingStateStorage,
  findConversationWorkingStateMaintenanceBlocker,
  recoverInterruptedConversationWorkingStateCompaction,
} from './conversation-working-state-compaction';

describe('Conversation Working State compaction engine', () => {
  let tempDir: string;
  let databasePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-compact-'));
    databasePath = path.join(tempDir, 'deepagents-checkpoints.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createFreelistHeavyFixture() {
    const db = new Database(databasePath);
    db.pragma('journal_mode = WAL');
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
    const insert = db.prepare("INSERT INTO checkpoints VALUES (?, '', ?, ?)");
    const seed = db.transaction(() => {
      insert.run('conversation-live', 'live-1', Buffer.from('live-state'));
      for (let index = 0; index < 12; index += 1) {
        insert.run('conversation-orphan', `orphan-${index}`, Buffer.alloc(64 * 1024, index));
      }
      db.prepare("INSERT INTO writes VALUES ('conversation-live', '', 'live-1', 'task-1', 0, ?)")
        .run(Buffer.from('pending-write'));
    });
    seed();
    db.close();
  }

  it('restores a valid rollback candidate when replacement was interrupted', () => {
    createFreelistHeavyFixture();
    const rollbackPath = `${databasePath}.rollback-interrupted`;
    fs.renameSync(databasePath, rollbackPath);

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(true);

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM checkpoints').get())
      .toEqual({ count: 13 });
    reopened.close();
    expect(fs.existsSync(rollbackPath)).toBe(false);
  });

  it('keeps a valid installed database and removes a stale rollback candidate', () => {
    createFreelistHeavyFixture();
    const rollbackPath = `${databasePath}.rollback-stale`;
    const compactPath = `${databasePath}.compact-stale`;
    fs.linkSync(databasePath, rollbackPath);
    fs.writeFileSync(compactPath, 'incomplete');

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(false);
    expect(fs.existsSync(databasePath)).toBe(true);
    expect(fs.existsSync(rollbackPath)).toBe(false);
    expect(fs.existsSync(compactPath)).toBe(false);
  });

  it('reconciles orphans, validates, replaces safely, preserves live state, and shrinks storage', () => {
    createFreelistHeavyFixture();
    const phases: string[] = [];
    const beforeBytes = fs.statSync(databasePath).size;

    const result = compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live'],
    }, {
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.physicalBytesAfter).toBeLessThan(beforeBytes);
    expect(phases).toEqual([
      'reconciling',
      'checkingSpace',
      'rebuilding',
      'validating',
      'replacing',
      'reopening',
    ]);
    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT thread_id, checkpoint_id, checkpoint FROM checkpoints').all())
      .toEqual([{ thread_id: 'conversation-live', checkpoint_id: 'live-1', checkpoint: Buffer.from('live-state') }]);
    expect(reopened.prepare('SELECT thread_id, value FROM writes').all())
      .toEqual([{ thread_id: 'conversation-live', value: Buffer.from('pending-write') }]);
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    reopened.close();
    expect(fs.readdirSync(tempDir).filter((name) => name.includes('.compact-') || name.includes('.rollback-'))).toEqual([]);
  });

  it('leaves the original usable when free space is insufficient', () => {
    createFreelistHeavyFixture();
    const original = fs.readFileSync(databasePath);

    expect(() => compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live', 'conversation-orphan'],
    }, {
      getAvailableDiskBytes: () => 0,
    })).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_DISK_SPACE' }));

    expect(fs.readFileSync(databasePath)).toEqual(original);
    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    reopened.close();
  });

  it('keeps the original as rollback candidate until the installed database reopens', () => {
    createFreelistHeavyFixture();
    const original = new Database(databasePath, { readonly: true });
    const originalRows = original
      .prepare('SELECT thread_id, checkpoint_id FROM checkpoints ORDER BY checkpoint_id')
      .all();
    original.close();

    expect(() => compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live', 'conversation-orphan'],
    }, {
      beforeReopening: () => { throw new Error('reopen rejected'); },
    })).toThrow(expect.objectContaining({ code: 'COMPACTION_FAILED' }));

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT thread_id, checkpoint_id FROM checkpoints ORDER BY checkpoint_id').all())
      .toEqual(originalRows);
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    reopened.close();
  });

  it('keeps the original when the rebuilt database fails integrity validation', () => {
    createFreelistHeavyFixture();

    expect(() => compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live'],
    }, {
      beforeValidation: (temporaryPath) => fs.writeFileSync(temporaryPath, 'not sqlite'),
    })).toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT checkpoint_id FROM checkpoints WHERE thread_id = ?').all('conversation-live'))
      .toEqual([{ checkpoint_id: 'live-1' }]);
    reopened.close();
  });
});

describe('findConversationWorkingStateMaintenanceBlocker', () => {
  it.each([
    ['agent_runs', "INSERT INTO agent_runs VALUES ('running')", 'ACTIVE_AGENT_RUN'],
    ['delegated_agent_runs', "INSERT INTO delegated_agent_runs VALUES ('queued')", 'ACTIVE_DELEGATED_AGENT_RUN'],
    ['capability_jobs', "INSERT INTO capability_jobs VALUES ('submitted')", 'ACTIVE_CAPABILITY_JOB'],
  ] as const)('rejects non-terminal work in %s with a stable reason', (_table, insert, expected) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-guard-'));
    const db = new Database(path.join(tempDir, 'cdf.db'));
    try {
      db.exec(`
        CREATE TABLE agent_runs (status TEXT NOT NULL);
        CREATE TABLE delegated_agent_runs (status TEXT NOT NULL);
        CREATE TABLE capability_jobs (status TEXT NOT NULL);
        ${insert};
      `);

      expect(findConversationWorkingStateMaintenanceBlocker(db)).toBe(expected);
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('allows maintenance when all work is terminal', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-guard-'));
    const db = new Database(path.join(tempDir, 'cdf.db'));
    try {
      db.exec(`
        CREATE TABLE agent_runs (status TEXT NOT NULL);
        CREATE TABLE delegated_agent_runs (status TEXT NOT NULL);
        CREATE TABLE capability_jobs (status TEXT NOT NULL);
        INSERT INTO agent_runs VALUES ('completed');
        INSERT INTO delegated_agent_runs VALUES ('interrupted');
        INSERT INTO capability_jobs VALUES ('canceled');
      `);

      expect(findConversationWorkingStateMaintenanceBlocker(db)).toBeNull();
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
