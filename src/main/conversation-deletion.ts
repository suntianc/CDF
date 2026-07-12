import type Database from 'better-sqlite3';

export const CONVERSATION_DELETE_ERROR_CODES = {
  ACTIVE_AGENT_RUN: 'CONVERSATION_DELETE_BLOCKED_ACTIVE_AGENT_RUN',
  ACTIVE_CAPABILITY_JOB: 'CONVERSATION_DELETE_BLOCKED_ACTIVE_CAPABILITY_JOB',
} as const;

export type ConversationDeleteErrorCode =
  typeof CONVERSATION_DELETE_ERROR_CODES[keyof typeof CONVERSATION_DELETE_ERROR_CODES];

export class ConversationDeleteError extends Error {
  constructor(
    public readonly code: ConversationDeleteErrorCode,
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ConversationDeleteError';
  }
}

export function deleteConversation(db: Database.Database, sessionId: string): void {
  db.transaction(() => {
    const activeRun = db.prepare(`SELECT 1 FROM agent_runs
      WHERE session_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1`
    ).get(sessionId);
    if (activeRun) {
      throw new ConversationDeleteError(
        CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
        'Cannot delete Conversation while an Agent Run is in progress.'
      );
    }

    const hasCapabilityJobsTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'capability_jobs' LIMIT 1"
    ).get();
    if (hasCapabilityJobsTable) {
      const activeJob = db.prepare(`SELECT 1 FROM capability_jobs
        WHERE source_session_id = ?
          AND status NOT IN ('completed', 'failed', 'canceled')
        LIMIT 1`
      ).get(sessionId);
      if (activeJob) {
        throw new ConversationDeleteError(
          CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
          'Cannot delete Conversation while a Background Capability Job is non-terminal.'
        );
      }
    }

    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  })();
}
