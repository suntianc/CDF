import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  function maintenanceArtifacts(): string[] {
    return fs.readdirSync(tempDir).filter(
      (name) => name.includes('.compact-') || name.includes('.rollback-')
    );
  }

  function createWalSnapshot(destinationPath: string): void {
    const sourcePath = path.join(tempDir, 'wal-snapshot-source.db');
    const source = new Database(sourcePath);
    source.pragma('journal_mode = WAL');
    source.exec('CREATE TABLE pending_state (value TEXT); INSERT INTO pending_state VALUES (\'in wal\')');
    fs.copyFileSync(sourcePath, destinationPath);
    fs.copyFileSync(`${sourcePath}-wal`, `${destinationPath}-wal`);
    fs.copyFileSync(`${sourcePath}-shm`, `${destinationPath}-shm`);
    source.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${sourcePath}${suffix}`, { force: true });
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

  it('keeps a valid installed database and removes every stale maintenance file family', () => {
    createFreelistHeavyFixture();
    const rollbackPath = `${databasePath}.rollback-stale`;
    const compactPath = `${databasePath}.compact-stale`;
    fs.linkSync(databasePath, rollbackPath);
    fs.writeFileSync(`${rollbackPath}-wal`, 'stale rollback wal');
    fs.writeFileSync(`${rollbackPath}-shm`, 'stale rollback shm');
    fs.writeFileSync(compactPath, 'incomplete');
    fs.writeFileSync(`${compactPath}-wal`, 'stale compact wal');
    fs.writeFileSync(`${compactPath}-shm`, 'stale compact shm');

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(false);

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it('preserves committed WAL state when the canonical database is already valid', () => {
    createWalSnapshot(databasePath);
    fs.writeFileSync(`${databasePath}.compact-interrupted`, 'incomplete rebuild');

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(false);

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT value FROM pending_state').get()).toEqual({ value: 'in wal' });
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it('fails closed and preserves evidence when a rollback has its own WAL state', () => {
    const rollbackPath = `${databasePath}.rollback-interrupted`;
    createWalSnapshot(rollbackPath);

    expect(() => recoverInterruptedConversationWorkingStateCompaction(databasePath))
      .toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    expect(fs.existsSync(databasePath)).toBe(false);
    const rollback = new Database(rollbackPath, { readonly: true });
    expect(rollback.prepare('SELECT value FROM pending_state').get()).toEqual({ value: 'in wal' });
    rollback.close();
  });

  it('fails closed when only canonical SQLite sidecars remain', () => {
    fs.writeFileSync(`${databasePath}-wal`, 'orphaned wal evidence');
    fs.writeFileSync(`${databasePath}-shm`, 'orphaned shm evidence');

    expect(() => recoverInterruptedConversationWorkingStateCompaction(databasePath))
      .toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    expect(fs.readFileSync(`${databasePath}-wal`, 'utf8')).toBe('orphaned wal evidence');
    expect(fs.readFileSync(`${databasePath}-shm`, 'utf8')).toBe('orphaned shm evidence');
  });

  it('never promotes a temporary rebuild that lacks a rollback candidate', () => {
    const temporaryPath = `${databasePath}.compact-interrupted`;
    const temporary = new Database(temporaryPath);
    temporary.exec('CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES (\'temp only\')');
    temporary.close();

    expect(() => recoverInterruptedConversationWorkingStateCompaction(databasePath))
      .toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    expect(fs.existsSync(databasePath)).toBe(false);
    const evidence = new Database(temporaryPath, { readonly: true });
    expect(evidence.prepare('SELECT value FROM evidence').get()).toEqual({ value: 'temp only' });
    evidence.close();
  });

  it('fails closed and preserves a corrupt rollback candidate as evidence', () => {
    const rollbackPath = `${databasePath}.rollback-corrupt`;
    fs.writeFileSync(rollbackPath, 'corrupt rollback evidence');

    expect(() => recoverInterruptedConversationWorkingStateCompaction(databasePath))
      .toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    expect(fs.readFileSync(rollbackPath, 'utf8')).toBe('corrupt rollback evidence');
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('fails closed when more than one distinct rollback database is valid', () => {
    const firstRollbackPath = `${databasePath}.rollback-first`;
    const secondRollbackPath = `${databasePath}.rollback-second`;
    const first = new Database(firstRollbackPath);
    first.exec('CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES (\'first\')');
    first.close();
    const second = new Database(secondRollbackPath);
    second.exec('CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES (\'second\')');
    second.close();

    expect(() => recoverInterruptedConversationWorkingStateCompaction(databasePath))
      .toThrow(expect.objectContaining({ code: 'INTEGRITY_CHECK_FAILED' }));

    expect(fs.existsSync(databasePath)).toBe(false);
    expect(fs.existsSync(firstRollbackPath)).toBe(true);
    expect(fs.existsSync(secondRollbackPath)).toBe(true);
  });

  it('restores a rollback without attaching stale canonical WAL files', () => {
    createFreelistHeavyFixture();
    const rollbackPath = `${databasePath}.rollback-interrupted`;
    fs.copyFileSync(databasePath, rollbackPath);
    fs.writeFileSync(databasePath, 'corrupt installed database');
    fs.writeFileSync(`${databasePath}-wal`, 'stale live wal');
    fs.writeFileSync(`${databasePath}-shm`, 'stale live shm');

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(true);
    if (fs.existsSync(`${databasePath}-wal`)) {
      expect(fs.readFileSync(`${databasePath}-wal`)).not.toEqual(Buffer.from('stale live wal'));
    }
    if (fs.existsSync(`${databasePath}-shm`)) {
      expect(fs.readFileSync(`${databasePath}-shm`)).not.toEqual(Buffer.from('stale live shm'));
    }

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM checkpoints').get())
      .toEqual({ count: 13 });
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
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
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it.each([
    ['temporary rebuild', {
      rebuildTemporaryDatabase: () => { throw new Error('rebuild interrupted'); },
    }],
    ['original-to-rollback replacement', {
      createRollback: () => { throw new Error('rollback interrupted'); },
    }],
    ['temporary-to-live replacement', {
      installTemporaryDatabase: () => { throw new Error('install interrupted'); },
    }],
  ])('keeps the original readable when %s fails', (_window, dependencies) => {
    createFreelistHeavyFixture();

    expect(() => compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live', 'conversation-orphan'],
    }, dependencies)).toThrow(expect.objectContaining({ code: 'COMPACTION_FAILED' }));

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM checkpoints').get())
      .toEqual({ count: 13 });
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it('restores the rollback when installation renames the database before reporting failure', () => {
    createFreelistHeavyFixture();
    let originalSizeBeforeInstall = 0;

    expect(() => compactConversationWorkingStateStorage({
      checkpointDatabasePath: databasePath,
      liveThreadIds: ['conversation-live'],
    }, {
      beforeValidation: () => {
        originalSizeBeforeInstall = fs.statSync(databasePath).size;
      },
      installTemporaryDatabase: (temporaryPath, installedPath) => {
        fs.renameSync(temporaryPath, installedPath);
        throw new Error('install failed after rename');
      },
    })).toThrow(expect.objectContaining({ code: 'COMPACTION_FAILED' }));

    expect(fs.statSync(databasePath).size).toBe(originalSizeBeforeInstall);
    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT checkpoint_id FROM checkpoints').all())
      .toEqual([{ checkpoint_id: 'live-1' }]);
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it('recovers after a process is forcibly terminated during a real SQLite rebuild', async () => {
    createFreelistHeavyFixture();
    const padding = new Database(databasePath);
    padding.exec('CREATE TABLE rebuild_padding (value BLOB)');
    const insertPadding = padding.prepare('INSERT INTO rebuild_padding VALUES (?)');
    padding.transaction(() => {
      for (let index = 0; index < 96; index += 1) {
        insertPadding.run(Buffer.alloc(1024 * 1024, index));
      }
    })();
    padding.close();
    const temporaryPath = `${databasePath}.compact-forced-exit`;
    let childOutput = '';
    const child = spawn(process.execPath, ['-e', `
      const Database = require('better-sqlite3');
      const source = new Database(process.env.CDF_SOURCE_PATH, { readonly: true });
      process.stdout.write('started\\n');
      setImmediate(() => {
        source.prepare('VACUUM INTO ?').run(process.env.CDF_REBUILD_PATH);
        process.stdout.write('completed\\n');
      });
      setInterval(() => undefined, 1000);
    `], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CDF_SOURCE_PATH: databasePath,
        CDF_REBUILD_PATH: temporaryPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      childOutput += chunk.toString();
    });
    const closed = new Promise<NodeJS.Signals | null>((resolve) => {
      child.once('close', (_code, signal) => resolve(signal));
    });
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (childOutput.includes('completed')) {
          clearInterval(poll);
          clearTimeout(timeout);
          child.kill('SIGKILL');
          reject(new Error('SQLite rebuild completed before forced termination.'));
          return;
        }
        if (
          childOutput.includes('started')
          && fs.existsSync(temporaryPath)
          && fs.statSync(temporaryPath).size > 0
        ) {
          clearInterval(poll);
          clearTimeout(timeout);
          child.kill('SIGKILL');
          resolve();
        }
      }, 1);
      const timeout = setTimeout(() => {
        clearInterval(poll);
        child.kill('SIGKILL');
        reject(new Error('Timed out waiting for SQLite rebuild.'));
      }, 10_000);
      child.once('error', (error) => {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(error);
      });
    });
    expect(await closed).toBe('SIGKILL');
    let temporaryContainsCompleteRebuild = false;
    try {
      const interrupted = new Database(temporaryPath, { readonly: true, fileMustExist: true });
      try {
        const paddingCount = interrupted
          .prepare('SELECT COUNT(*) AS count FROM rebuild_padding')
          .get() as { count: number };
        temporaryContainsCompleteRebuild = interrupted.pragma('integrity_check', { simple: true }) === 'ok'
          && paddingCount.count === 96;
      } finally {
        interrupted.close();
      }
    } catch {
      // A partial SQLite file is the expected evidence of interruption during VACUUM INTO.
    }
    expect(temporaryContainsCompleteRebuild).toBe(false);

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(false);

    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM checkpoints').get())
      .toEqual({ count: 13 });
    reopened.close();
    expect(maintenanceArtifacts()).toEqual([]);
  });

  it('reopens a recovered database through the real saver with its checkpoint chain and pending writes', async () => {
    const saver = SqliteSaver.fromConnString(databasePath);
    const metadata: CheckpointMetadata = { source: 'input', step: -1, parents: {} };
    const first: Checkpoint = {
      v: 4,
      id: 'checkpoint-1',
      ts: '2026-07-14T00:00:00.000Z',
      channel_values: { messages: ['first'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    };
    const firstConfig = await saver.put(
      { configurable: { thread_id: 'conversation-live', checkpoint_ns: '' } },
      first,
      metadata
    );
    await saver.put(
      firstConfig,
      { ...first, id: 'checkpoint-2', channel_values: { messages: ['second'] } },
      { ...metadata, source: 'loop', step: 0 }
    );
    await saver.putWrites(firstConfig, [['messages', 'pending']], 'task-1');
    saver.db.pragma('wal_checkpoint(TRUNCATE)');
    saver.db.close();
    const rollbackPath = `${databasePath}.rollback-interrupted`;
    fs.renameSync(databasePath, rollbackPath);

    expect(recoverInterruptedConversationWorkingStateCompaction(databasePath)).toBe(true);

    const reopened = SqliteSaver.fromConnString(databasePath);
    await expect(reopened.getTuple({
      configurable: { thread_id: 'conversation-live', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-2' } });
    const checkpointIds: string[] = [];
    for await (const tuple of reopened.list({
      configurable: { thread_id: 'conversation-live', checkpoint_ns: '' },
    })) {
      checkpointIds.push(tuple.checkpoint.id);
    }
    expect(checkpointIds).toEqual(['checkpoint-2', 'checkpoint-1']);
    expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM writes').get())
      .toEqual({ count: 1 });
    reopened.db.close();
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
      reopenDatabase: () => { throw new Error('reopen rejected'); },
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
