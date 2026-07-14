import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { getConversationPromptSnapshot } from './conversation-prompt-snapshot';

const databasePaths: string[] = [];

afterEach(() => {
  for (const databasePath of databasePaths.splice(0)) {
    fs.rmSync(databasePath, { force: true });
  }
});

describe('Conversation Prompt Snapshot', () => {
  it('persists the captured complete prompt across restart and ignores later Master edits', () => {
    const databasePath = path.join(os.tmpdir(), `cdf-prompt-snapshot-${crypto.randomUUID()}.db`);
    databasePaths.push(databasePath);
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        prompt_snapshot TEXT
      );
      INSERT INTO sessions (id, prompt_snapshot) VALUES ('existing-conversation', 'Captured complete prompt');
    `);
    db.close();

    const restartedDb = new Database(databasePath);
    expect(getConversationPromptSnapshot(restartedDb, 'existing-conversation')).toBe('Captured complete prompt');
    restartedDb.prepare('UPDATE sessions SET prompt_snapshot = prompt_snapshot WHERE id = ?').run('existing-conversation');
    expect(getConversationPromptSnapshot(restartedDb, 'existing-conversation')).toBe('Captured complete prompt');
    restartedDb.close();
  });
});
