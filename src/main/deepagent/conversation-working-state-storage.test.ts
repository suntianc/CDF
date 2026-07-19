import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectConversationWorkingStateStorage } from './conversation-working-state-storage';

describe('inspectConversationWorkingStateStorage', () => {
  let tempDir: string;
  let databasePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-storage-'));
    databasePath = path.join(tempDir, 'deepagents-checkpoints.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports zero usage for a missing database without creating it', () => {
    expect(inspectConversationWorkingStateStorage(databasePath)).toEqual({
      physicalBytes: 0,
      estimatedReclaimableBytes: 0,
    });
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('reports valid bounded usage for an empty database', () => {
    new Database(databasePath).close();

    const status = inspectConversationWorkingStateStorage(databasePath);

    expect(status.physicalBytes).toBe(fs.statSync(databasePath).size);
    expect(status.estimatedReclaimableBytes).toBeGreaterThanOrEqual(0);
    expect(status.estimatedReclaimableBytes).toBeLessThanOrEqual(status.physicalBytes);
  });

  it('accounts for live SQLite sidecars in physical usage', () => {
    const db = new Database(databasePath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE payloads (value BLOB)');
    db.prepare('INSERT INTO payloads VALUES (?)').run(Buffer.alloc(256 * 1024, 1));

    const expectedPhysicalBytes = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
      .reduce((total, filePath) => total + (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0), 0);
    const status = inspectConversationWorkingStateStorage(databasePath);

    expect(status.physicalBytes).toBe(expectedPhysicalBytes);
    expect(status.estimatedReclaimableBytes).toBeLessThanOrEqual(expectedPhysicalBytes);
    db.close();
  });

  it('estimates reclaimable space for a freelist-heavy database without reading payloads', () => {
    const db = new Database(databasePath);
    db.exec('CREATE TABLE payloads (id INTEGER PRIMARY KEY, value BLOB)');
    const insert = db.prepare('INSERT INTO payloads (value) VALUES (?)');
    const insertMany = db.transaction(() => {
      for (let index = 0; index < 24; index += 1) {
        insert.run(Buffer.alloc(128 * 1024, index));
      }
    });
    insertMany();
    db.exec('DELETE FROM payloads WHERE id <= 20');
    db.close();

    const status = inspectConversationWorkingStateStorage(databasePath);

    expect(status.estimatedReclaimableBytes).toBeGreaterThan(0);
    expect(status.estimatedReclaimableBytes).toBeLessThanOrEqual(status.physicalBytes);
  });
});
