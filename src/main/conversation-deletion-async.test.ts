import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { deleteConversation } from './conversation-deletion';

function createBusinessDatabase() {
  let conversationDeleted = false;
  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.startsWith('DELETE FROM sessions')) {
        return {
          run: vi.fn(() => {
            conversationDeleted = true;
          }),
        };
      }
      return { get: vi.fn(() => undefined) };
    }),
    transaction: <Result>(operation: () => Result) => operation,
  } as unknown as Database.Database;

  return {
    db,
    conversationDeleted: () => conversationDeleted,
  };
}

describe('deleteConversation asynchronous Working State cleanup', () => {
  it('returns after the business commit without waiting for Working State cleanup', async () => {
    const { db, conversationDeleted } = createBusinessDatabase();
    let resolveCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const deleteThread = vi.fn(() => cleanup);
    let deletionSettled = false;
    const deletion = deleteConversation(db, 'conversation-1', { deleteThread })
      .then(() => {
        deletionSettled = true;
      });

    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(conversationDeleted()).toBe(true);
      expect(deletionSettled).toBe(true);
      expect(deleteThread).not.toHaveBeenCalled();

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(deleteThread).toHaveBeenCalledWith('conversation-1');
    } finally {
      resolveCleanup();
      await deletion;
    }
  });
});
