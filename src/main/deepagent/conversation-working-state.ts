import path from 'path';
import { app } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type {
  ConversationWorkingStateBlockReason,
  ConversationWorkingStateFailureReason,
  ConversationWorkingStateMaintenancePhase,
  ConversationWorkingStateStorageStatus,
} from '../../shared/conversation-working-state';
import {
  CONVERSATION_WORKING_STATE_BLOCK_REASONS,
  CONVERSATION_WORKING_STATE_FAILURE_REASONS,
} from '../../shared/conversation-working-state';
import type { ConversationWorkingStateReconciliationRunner } from './conversation-working-state-worker-runner';
import type { ConversationWorkingStateCompactionRunnerContract } from './conversation-working-state-compaction-runner';
import { recoverInterruptedConversationWorkingStateCompaction } from './conversation-working-state-compaction';
import {
  getConversationWorkingStatePhysicalBytes,
  inspectConversationWorkingStateStorage,
} from './conversation-working-state-storage';

export const CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED =
  'CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED' as const;

export const STARTUP_RECONCILIATION_FAILED =
  CONVERSATION_WORKING_STATE_FAILURE_REASONS.STARTUP_RECONCILIATION_FAILED;

export type { ConversationWorkingStateStorageStatus } from '../../shared/conversation-working-state';

export type StartupReconciliationOutcome =
  | { ok: true; deletedThreadCount: number }
  | {
      ok: false;
      failureReason: typeof STARTUP_RECONCILIATION_FAILED;
      error: unknown;
    };

export type ConversationWorkingStateCompactionOutcome =
  | { ok: true; physicalBytesBefore: number; physicalBytesAfter: number }
  | { ok: false; blockedReason: ConversationWorkingStateBlockReason }
  | { ok: false; failureReason: ConversationWorkingStateFailureReason; error: unknown };

export class ConversationWorkingStateMaintenanceError extends Error {
  readonly code = CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED;
  readonly recoverable = true;

  constructor() {
    super('Conversation Working State is temporarily unavailable during maintenance.');
    this.name = 'ConversationWorkingStateMaintenanceError';
  }
}

export interface ConversationWorkingStateLifecycle {
  beginRuntimeUse(): () => void;
  beginCapabilityJobUse(): () => void;
  acquireSaver(): SqliteSaver;
  /** Blocks new runtime acquisitions without invalidating a saver already in use. */
  enterMaintenance(): void;
  leaveMaintenance(): void;
  /** Lifecycle cleanup remains available during startup analysis, but not file replacement. */
  deleteThread(threadId: string): Promise<void>;
  assertConversationDeletionAllowed(): void;
  reconcileOrphansAtStartup(
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateReconciliationRunner
  ): Promise<StartupReconciliationOutcome>;
  compact(
    readBlocker: () => ConversationWorkingStateBlockReason | null,
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateCompactionRunnerContract
  ): Promise<ConversationWorkingStateCompactionOutcome>;
  getStorageStatus(): ConversationWorkingStateStorageStatus;
  /** Closes the shared saver after callers have established that no run is using it. */
  close(): void;
}

type OperationalStorageStatus = Pick<
  ConversationWorkingStateStorageStatus,
  'phase' | 'maintenancePhase' | 'blockedReason' | 'failureReason'
>;

const NORMAL_STORAGE_STATUS: OperationalStorageStatus = {
  phase: 'normal',
  maintenancePhase: null,
  blockedReason: null,
  failureReason: null,
};

function isFailureReason(value: unknown): value is ConversationWorkingStateFailureReason {
  return typeof value === 'string'
    && Object.values(CONVERSATION_WORKING_STATE_FAILURE_REASONS).includes(
      value as ConversationWorkingStateFailureReason
    );
}

class SqliteConversationWorkingStateLifecycle implements ConversationWorkingStateLifecycle {
  private saver: SqliteSaver | null = null;
  private maintenanceLocked = false;
  private recoveryBlocked = false;
  private compactionLocked = false;
  private activeRuntimeUsers = 0;
  private activeCapabilityJobUsers = 0;
  private cleanupOperations = new Set<Promise<void>>();
  private storageInspection = { physicalBytes: 0, estimatedReclaimableBytes: 0 };
  private storageStatus: OperationalStorageStatus = { ...NORMAL_STORAGE_STATUS };

  constructor(private readonly resolveDatabasePath: () => string) {}

  beginRuntimeUse(): () => void {
    this.assertSaverAvailable();
    this.activeRuntimeUsers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRuntimeUsers -= 1;
    };
  }

  beginCapabilityJobUse(): () => void {
    this.assertSaverAvailable();
    this.activeCapabilityJobUsers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCapabilityJobUsers -= 1;
    };
  }

  acquireSaver(): SqliteSaver {
    this.assertSaverAvailable();
    return this.getOrCreateSaver();
  }

  enterMaintenance(): void {
    if (this.maintenanceLocked) {
      throw new ConversationWorkingStateMaintenanceError();
    }
    this.maintenanceLocked = true;
  }

  leaveMaintenance(): void {
    this.maintenanceLocked = false;
  }

  deleteThread(threadId: string): Promise<void> {
    if (this.compactionLocked || this.recoveryBlocked) {
      return Promise.reject(new ConversationWorkingStateMaintenanceError());
    }
    const operation = this.getOrCreateSaver().deleteThread(threadId);
    const trackedOperation = operation.finally(() => {
      this.cleanupOperations.delete(trackedOperation);
    });
    this.cleanupOperations.add(trackedOperation);
    return trackedOperation;
  }

  assertConversationDeletionAllowed(): void {
    if (this.compactionLocked || this.recoveryBlocked) {
      throw new ConversationWorkingStateMaintenanceError();
    }
  }

  async reconcileOrphansAtStartup(
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateReconciliationRunner
  ): Promise<StartupReconciliationOutcome> {
    this.captureStorageInspection();
    this.enterMaintenance();
    this.storageStatus = {
      phase: 'analyzing',
      maintenancePhase: 'reconciling',
      blockedReason: null,
      failureReason: null,
    };
    let recoveryCompleted = false;
    try {
      this.close();
      recoverInterruptedConversationWorkingStateCompaction(this.resolveDatabasePath());
      recoveryCompleted = true;
      this.recoveryBlocked = false;
      const liveThreadIds = [...readLiveThreadIds()];
      const result = await runner.run({
        checkpointDatabasePath: this.resolveDatabasePath(),
        liveThreadIds,
      });
      this.storageStatus = { ...NORMAL_STORAGE_STATUS };
      return { ok: true, deletedThreadCount: result.deletedThreadCount };
    } catch (error) {
      if (!recoveryCompleted) this.recoveryBlocked = true;
      this.storageStatus = {
        phase: 'failed',
        maintenancePhase: null,
        blockedReason: null,
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

  async compact(
    readBlocker: () => ConversationWorkingStateBlockReason | null,
    readLiveThreadIds: () => readonly string[],
    runner: ConversationWorkingStateCompactionRunnerContract
  ): Promise<ConversationWorkingStateCompactionOutcome> {
    if (this.recoveryBlocked) throw new ConversationWorkingStateMaintenanceError();
    this.captureStorageInspection();
    this.enterMaintenance();
    this.compactionLocked = true;
    this.storageStatus = {
      phase: 'optimizing',
      maintenancePhase: 'preparing',
      blockedReason: null,
      failureReason: null,
    };
    try {
      const blockedReason = this.activeRuntimeUsers > 0
        ? CONVERSATION_WORKING_STATE_BLOCK_REASONS.ACTIVE_AGENT_RUN
        : this.activeCapabilityJobUsers > 0
          ? CONVERSATION_WORKING_STATE_BLOCK_REASONS.ACTIVE_CAPABILITY_JOB
          : readBlocker();
      if (blockedReason) {
        this.storageStatus = {
          ...NORMAL_STORAGE_STATUS,
          blockedReason,
        };
        return { ok: false, blockedReason };
      }

      await Promise.allSettled([...this.cleanupOperations]);
      const liveThreadIds = [...readLiveThreadIds()];
      this.checkpointAndClose();
      const result = await runner.run(
        {
          checkpointDatabasePath: this.resolveDatabasePath(),
          liveThreadIds,
        },
        (maintenancePhase: ConversationWorkingStateMaintenancePhase) => {
          this.storageStatus = {
            phase: 'optimizing',
            maintenancePhase,
            blockedReason: null,
            failureReason: null,
          };
        }
      );
      this.storageInspection = {
        physicalBytes: result.physicalBytesAfter,
        estimatedReclaimableBytes: 0,
      };
      this.storageStatus = { ...NORMAL_STORAGE_STATUS };
      return { ok: true, ...result };
    } catch (error) {
      let outcomeError = error;
      try {
        this.close();
        recoverInterruptedConversationWorkingStateCompaction(this.resolveDatabasePath());
        this.recoveryBlocked = false;
      } catch (recoveryError) {
        outcomeError = recoveryError;
        this.recoveryBlocked = true;
      }
      const code = typeof outcomeError === 'object' && outcomeError !== null && 'code' in outcomeError
        ? (outcomeError as { code?: unknown }).code
        : undefined;
      const failureReason = isFailureReason(code)
        ? code
        : CONVERSATION_WORKING_STATE_FAILURE_REASONS.COMPACTION_FAILED;
      this.storageStatus = {
        phase: 'failed',
        maintenancePhase: null,
        blockedReason: null,
        failureReason,
      };
      return { ok: false, failureReason, error: outcomeError };
    } finally {
      this.compactionLocked = false;
      this.leaveMaintenance();
    }
  }

  getStorageStatus(): ConversationWorkingStateStorageStatus {
    if (this.maintenanceLocked) {
      return { ...this.storageStatus, ...this.storageInspection };
    }
    try {
      this.storageInspection = inspectConversationWorkingStateStorage(this.resolveDatabasePath());
      return { ...this.storageStatus, ...this.storageInspection };
    } catch {
      let physicalBytes = 0;
      try {
        physicalBytes = getConversationWorkingStatePhysicalBytes(this.resolveDatabasePath());
      } catch {
        // A stable status is more useful to Settings than leaking filesystem failures.
      }
      return {
        phase: 'failed',
        maintenancePhase: null,
        physicalBytes,
        estimatedReclaimableBytes: 0,
        blockedReason: this.storageStatus.blockedReason,
        failureReason: this.storageStatus.failureReason
          ?? CONVERSATION_WORKING_STATE_FAILURE_REASONS.STORAGE_INSPECTION_FAILED,
      };
    }
  }

  close(): void {
    const saver = this.saver;
    this.saver = null;
    saver?.db.close();
  }

  private assertSaverAvailable(): void {
    if (this.maintenanceLocked || this.recoveryBlocked) {
      throw new ConversationWorkingStateMaintenanceError();
    }
  }

  private captureStorageInspection(): void {
    if (this.maintenanceLocked) return;
    try {
      this.storageInspection = inspectConversationWorkingStateStorage(this.resolveDatabasePath());
    } catch {
      // The operation itself reports a stable failure if the file cannot be opened.
    }
  }

  private checkpointAndClose(): void {
    const saver = this.saver;
    if (!saver) return;
    const checkpoint = saver.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (checkpoint.some((row) => row.busy > 0)) {
      throw new Error('Conversation Working State is busy.');
    }
    this.close();
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
