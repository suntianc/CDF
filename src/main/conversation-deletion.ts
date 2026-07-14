import type Database from 'better-sqlite3';
import {
  CONVERSATION_DELETE_ERROR_CODES,
  type ConversationDeleteErrorCode,
} from '../shared/conversation-deletion';

export { CONVERSATION_DELETE_ERROR_CODES } from '../shared/conversation-deletion';

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

    const hasDelegatedRunsTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'delegated_agent_runs' LIMIT 1"
    ).get();
    if (hasDelegatedRunsTable) {
      const activeDelegatedRun = db.prepare(`SELECT 1 FROM delegated_agent_runs
        JOIN agent_runs ON agent_runs.id = delegated_agent_runs.parent_run_id
        WHERE agent_runs.session_id = ?
          AND delegated_agent_runs.status IN ('queued', 'running', 'waiting_approval')
        LIMIT 1`
      ).get(sessionId);
      if (activeDelegatedRun) {
        throw new ConversationDeleteError(
          CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
          'Cannot delete Conversation while a Delegated Agent Run is in progress.'
        );
      }
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
