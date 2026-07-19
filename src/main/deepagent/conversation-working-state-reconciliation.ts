import fs from 'fs';
import Database from 'better-sqlite3';

export interface ConversationWorkingStateReconciliationRequest {
  checkpointDatabasePath: string;
  liveThreadIds: readonly string[];
}

export interface ConversationWorkingStateReconciliationResult {
  deletedThreadCount: number;
}

export function conversationWorkingStateTableExists(
  db: Database.Database,
  tableName: string
): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).get(tableName));
}

export function reconcileOrphanConversationWorkingState(
  request: ConversationWorkingStateReconciliationRequest
): ConversationWorkingStateReconciliationResult {
  if (!fs.existsSync(request.checkpointDatabasePath)) {
    return { deletedThreadCount: 0 };
  }

  const db = new Database(request.checkpointDatabasePath, { fileMustExist: true });
  try {
    const hasCheckpoints = conversationWorkingStateTableExists(db, 'checkpoints');
    const hasWrites = conversationWorkingStateTableExists(db, 'writes');
    if (!hasCheckpoints && !hasWrites) {
      return { deletedThreadCount: 0 };
    }

    const identityQueries = [
      hasCheckpoints ? 'SELECT DISTINCT thread_id FROM checkpoints' : null,
      hasWrites ? 'SELECT DISTINCT thread_id FROM writes' : null,
    ].filter((query): query is string => query !== null);
    const rows = db.prepare(identityQueries.join(' UNION ')).all() as Array<{ thread_id: string }>;
    const liveThreadIds = new Set(request.liveThreadIds);
    const orphanThreadIds = rows
      .map((row) => row.thread_id)
      .filter((threadId) => !liveThreadIds.has(threadId));

    const deleteOrphans = db.transaction(() => {
      const deleteWrites = hasWrites
        ? db.prepare('DELETE FROM writes WHERE thread_id = ?')
        : null;
      const deleteCheckpoints = hasCheckpoints
        ? db.prepare('DELETE FROM checkpoints WHERE thread_id = ?')
        : null;
      for (const threadId of orphanThreadIds) {
        deleteWrites?.run(threadId);
        deleteCheckpoints?.run(threadId);
      }
    });
    deleteOrphans();

    return { deletedThreadCount: orphanThreadIds.length };
  } finally {
    db.close();
  }
}
