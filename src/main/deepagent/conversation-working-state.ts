import path from 'path';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

export const CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED =
  'CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED' as const;

export class ConversationWorkingStateMaintenanceError extends Error {
  readonly code = CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED;
  readonly recoverable = true;

  constructor() {
    super('Conversation Working State is temporarily unavailable during maintenance.');
    this.name = 'ConversationWorkingStateMaintenanceError';
  }
}

export interface ConversationWorkingStateLifecycle {
  acquireSaver(): SqliteSaver;
  /** Blocks new runtime acquisitions without invalidating a saver already in use. */
  enterMaintenance(): void;
  leaveMaintenance(): void;
  /** Lifecycle cleanup remains available while runtime acquisition is locked. */
  deleteThread(threadId: string): Promise<void>;
  /** Closes the shared saver after callers have established that no run is using it. */
  close(): void;
}

class SqliteConversationWorkingStateLifecycle implements ConversationWorkingStateLifecycle {
  private saver: SqliteSaver | null = null;
  private maintenanceLocked = false;

  constructor(private readonly resolveDatabasePath: () => string) {}

  acquireSaver(): SqliteSaver {
    if (this.maintenanceLocked) {
      throw new ConversationWorkingStateMaintenanceError();
    }
    return this.getOrCreateSaver();
  }

  enterMaintenance(): void {
    this.maintenanceLocked = true;
  }

  leaveMaintenance(): void {
    this.maintenanceLocked = false;
  }

  deleteThread(threadId: string): Promise<void> {
    return this.getOrCreateSaver().deleteThread(threadId);
  }

  close(): void {
    const saver = this.saver;
    this.saver = null;
    saver?.db.close();
  }

  private getOrCreateSaver(): SqliteSaver {
    this.saver ??= SqliteSaver.fromConnString(this.resolveDatabasePath());
    return this.saver;
  }
}

export function createConversationWorkingStateLifecycle(
  resolveDatabasePath: () => string
): ConversationWorkingStateLifecycle {
  return new SqliteConversationWorkingStateLifecycle(resolveDatabasePath);
}

export const conversationWorkingStateLifecycle = createConversationWorkingStateLifecycle(
  () => path.join(app.getPath('userData'), 'deepagents-checkpoints.db')
);
