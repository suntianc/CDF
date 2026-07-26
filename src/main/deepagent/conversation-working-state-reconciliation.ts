import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
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

export type ConversationWorkingStateWorkerResponse =
  | { ok: true; result: ConversationWorkingStateReconciliationResult }
  | { ok: false; error: string };

export interface ConversationWorkingStateWorker {
  unref(): void;
  once(event: 'message', listener: (message: ConversationWorkingStateWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

type WorkerFactory = (
  workerPath: string,
  request: ConversationWorkingStateReconciliationRequest
) => ConversationWorkingStateWorker;

const createNodeWorker: WorkerFactory = (workerPath, request) =>
  new Worker(workerPath, { workerData: request });

export interface ConversationWorkingStateReconciliationRunner {
  run(
    request: ConversationWorkingStateReconciliationRequest
  ): Promise<ConversationWorkingStateReconciliationResult>;
}

export class ConversationWorkingStateWorkerRunner
implements ConversationWorkingStateReconciliationRunner {
  constructor(
    private readonly resolveWorkerPath: () => string,
    private readonly createWorker: WorkerFactory = createNodeWorker
  ) {}

  run(
    request: ConversationWorkingStateReconciliationRequest
  ): Promise<ConversationWorkingStateReconciliationResult> {
    return new Promise((resolve, reject) => {
      const worker = this.createWorker(this.resolveWorkerPath(), request);
      worker.unref();
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      worker.once('message', (message) => {
        settle(() => {
          if (message.ok) resolve(message.result);
          else reject(new Error(message.error));
        });
      });
      worker.once('error', (error) => settle(() => reject(error)));
      worker.once('exit', (code) => {
        settle(() => reject(new Error(
          code === 0
            ? 'Conversation Working State Worker exited without a result.'
            : `Conversation Working State Worker exited with code ${code}.`
        )));
      });
    });
  }
}

/** Default worker-backed runner: the reconciliation worker bundle sits beside the main bundle. */
export function createConversationWorkingStateReconciliationRunner(): ConversationWorkingStateReconciliationRunner {
  return new ConversationWorkingStateWorkerRunner(
    () => path.join(__dirname, 'conversation-working-state-reconciliation-worker.js')
  );
}
