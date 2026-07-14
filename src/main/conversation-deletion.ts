import type Database from 'better-sqlite3';
import log from './logger';
import type { ConversationWorkingStateLifecycle } from './deepagent/conversation-working-state';
import {
  CONVERSATION_DELETE_ERROR_CODES,
  PROJECT_DELETE_ERROR_CODES,
  type ConversationDeleteErrorCode,
  type ProjectDeleteErrorCode,
} from '../shared/conversation-deletion';

export {
  CONVERSATION_DELETE_ERROR_CODES,
  PROJECT_DELETE_ERROR_CODES,
} from '../shared/conversation-deletion';

export class ConversationDeleteError extends Error {
  constructor(
    public readonly code: ConversationDeleteErrorCode,
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ConversationDeleteError';
  }
}

export class ProjectDeleteError extends Error {
  constructor(
    public readonly code: ProjectDeleteErrorCode,
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ProjectDeleteError';
  }
}

type WorkingStateDeletion = Pick<ConversationWorkingStateLifecycle, 'deleteThread'>;
type ConversationDeletionBlocker = 'active-agent-run' | 'active-capability-job';

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).get(tableName));
}

function findConversationDeletionBlocker(
  db: Database.Database,
  sessionId: string
): ConversationDeletionBlocker | null {
  const activeRun = db.prepare(`SELECT 1 FROM agent_runs
    WHERE session_id = ? AND status IN ('running', 'waiting_approval') LIMIT 1`
  ).get(sessionId);
  if (activeRun) return 'active-agent-run';

  if (tableExists(db, 'delegated_agent_runs')) {
    const activeDelegatedRun = db.prepare(`SELECT 1 FROM delegated_agent_runs
      JOIN agent_runs ON agent_runs.id = delegated_agent_runs.parent_run_id
      WHERE agent_runs.session_id = ?
        AND delegated_agent_runs.status IN ('queued', 'running', 'waiting_approval')
      LIMIT 1`
    ).get(sessionId);
    if (activeDelegatedRun) return 'active-agent-run';
  }

  if (tableExists(db, 'capability_jobs')) {
    const activeJob = db.prepare(`SELECT 1 FROM capability_jobs
      WHERE source_session_id = ?
        AND status NOT IN ('completed', 'failed', 'canceled')
      LIMIT 1`
    ).get(sessionId);
    if (activeJob) return 'active-capability-job';
  }

  return null;
}

function assertConversationCanBeDeleted(db: Database.Database, sessionId: string): void {
  const blocker = findConversationDeletionBlocker(db, sessionId);
  if (blocker === 'active-agent-run') {
    throw new ConversationDeleteError(
      CONVERSATION_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
      'Cannot delete Conversation while an Agent Run is in progress.'
    );
  }
  if (blocker === 'active-capability-job') {
    throw new ConversationDeleteError(
      CONVERSATION_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
      'Cannot delete Conversation while a Background Capability Job is non-terminal.'
    );
  }
}

function assertProjectConversationCanBeDeleted(
  db: Database.Database,
  projectId: string,
  sessionId: string
): void {
  const blocker = findConversationDeletionBlocker(db, sessionId);
  if (blocker === 'active-agent-run') {
    throw new ProjectDeleteError(
      PROJECT_DELETE_ERROR_CODES.ACTIVE_AGENT_RUN,
      `Cannot delete Project ${projectId} while one of its Agent Runs is in progress.`
    );
  }
  if (blocker === 'active-capability-job') {
    throw new ProjectDeleteError(
      PROJECT_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
      `Cannot delete Project ${projectId} while one of its Background Capability Jobs is non-terminal.`
    );
  }
}

async function deleteWorkingStateThreads(
  threadIds: readonly string[],
  workingState: WorkingStateDeletion
): Promise<void> {
  for (const threadId of threadIds) {
    try {
      await workingState.deleteThread(threadId);
    } catch (error) {
      log.warn(`[conversation-deletion] Working State cleanup failed for ${threadId}:`, error);
    }
  }
}

export async function deleteConversation(
  db: Database.Database,
  sessionId: string,
  workingState: WorkingStateDeletion
): Promise<void> {
  db.transaction(() => {
    assertConversationCanBeDeleted(db, sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  })();

  await deleteWorkingStateThreads([sessionId], workingState);
}

export async function deleteProject(
  db: Database.Database,
  projectId: string,
  workingState: WorkingStateDeletion
): Promise<void> {
  if (projectId === 'default-project') {
    throw new ProjectDeleteError(
      PROJECT_DELETE_ERROR_CODES.PROTECTED_PROJECT,
      'The default Project cannot be deleted.'
    );
  }

  const sessionIds = db.transaction(() => {
    const sessions = db.prepare('SELECT id FROM sessions WHERE project_id = ?')
      .all(projectId) as Array<{ id: string }>;

    for (const session of sessions) {
      assertProjectConversationCanBeDeleted(db, projectId, session.id);
    }

    if (tableExists(db, 'capability_jobs')) {
      const activeProjectJob = db.prepare(`SELECT 1 FROM capability_jobs
        WHERE project_id = ?
          AND status NOT IN ('completed', 'failed', 'canceled')
        LIMIT 1`
      ).get(projectId);
      if (activeProjectJob) {
        throw new ProjectDeleteError(
          PROJECT_DELETE_ERROR_CODES.ACTIVE_CAPABILITY_JOB,
          `Cannot delete Project ${projectId} while one of its Background Capability Jobs is non-terminal.`
        );
      }
      db.prepare('DELETE FROM capability_jobs WHERE project_id = ?').run(projectId);
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    return sessions.map((session) => session.id);
  })();

  await deleteWorkingStateThreads(sessionIds, workingState);
}
