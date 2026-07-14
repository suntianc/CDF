import type Database from 'better-sqlite3';

/** Reads the durable prompt captured when a Conversation was created. */
export function getConversationPromptSnapshot(
  db: Database.Database,
  sessionId: string,
): string | null {
  const session = db.prepare('SELECT prompt_snapshot FROM sessions WHERE id = ?').get(sessionId) as
    | { prompt_snapshot?: string | null }
    | undefined;
  return session?.prompt_snapshot ?? null;
}
