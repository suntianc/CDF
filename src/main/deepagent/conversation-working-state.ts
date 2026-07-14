import path from 'path';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { ConversationWorkingStateReconciliationRunner } from './conversation-working-state-worker-runner';

export const CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED =
  'CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED' as const;

export const STARTUP_RECONCILIATION_FAILED = 'STARTUP_RECONCILIATION_FAILED' as const;

export type ConversationWorkingStateStorageStatus =
  | { phase: 'normal'; failureReason: null }
  | { phase: 'analyzing'; failureReason: null }
  | { phase: 'failed'; failureReason: typeof STARTUP_RECONCILIATION_FAILED };

export type StartupReconciliationOutcome =
  | { ok: true; deletedThreadCount: number }
  | {
      ok: false;
      failureReason: typeof STARTUP_RECONCILIATION_FAILED;
      error: unknown;
    };

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
  reconcileOrphansAtStartup(
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateReconciliationRunner
  ): Promise<StartupReconciliationOutcome>;
  getStorageStatus(): ConversationWorkingStateStorageStatus;
  /** Closes the shared saver after callers have established that no run is using it. */
  close(): void;
}

class SqliteConversationWorkingStateLifecycle implements ConversationWorkingStateLifecycle {
  private saver: SqliteSaver | null = null;
  private maintenanceLocked = false;
  private storageStatus: ConversationWorkingStateStorageStatus = {
    phase: 'normal',
    failureReason: null,
  };

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

  async reconcileOrphansAtStartup(
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateReconciliationRunner
  ): Promise<StartupReconciliationOutcome> {
    this.enterMaintenance();
    this.storageStatus = { phase: 'analyzing', failureReason: null };
    try {
      const liveThreadIds = [...readLiveThreadIds()];
      this.close();
      const result = await runner.run({
        checkpointDatabasePath: this.resolveDatabasePath(),
        liveThreadIds,
      });
      this.storageStatus = { phase: 'normal', failureReason: null };
      return { ok: true, deletedThreadCount: result.deletedThreadCount };
    } catch (error) {
      this.storageStatus = {
        phase: 'failed',
        failureReason: STARTUP_RECONCILIATION_FAILED,
      };
      return {
        ok: false,
        failureReason: STARTUP_RECONCILIATION_FAILED,
        error,
      };
    } finally {
      this.leaveMaintenance();
    }
  }

  getStorageStatus(): ConversationWorkingStateStorageStatus {
    return { ...this.storageStatus };
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
