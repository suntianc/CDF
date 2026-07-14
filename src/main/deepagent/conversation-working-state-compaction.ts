import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type {
  ConversationWorkingStateBlockReason,
  ConversationWorkingStateFailureReason,
  ConversationWorkingStateMaintenancePhase,
} from '../../shared/conversation-working-state';
import {
  CONVERSATION_WORKING_STATE_BLOCK_REASONS,
  CONVERSATION_WORKING_STATE_FAILURE_REASONS,
} from '../../shared/conversation-working-state';
import {
  conversationWorkingStateTableExists,
  reconcileOrphanConversationWorkingState,
} from './conversation-working-state-reconciliation';
import {
  getConversationWorkingStatePhysicalBytes,
  inspectConversationWorkingStateStorage,
} from './conversation-working-state-storage';

export interface ConversationWorkingStateCompactionRequest {
  checkpointDatabasePath: string;
  liveThreadIds: readonly string[];
}

export interface ConversationWorkingStateCompactionResult {
  physicalBytesBefore: number;
  physicalBytesAfter: number;
}

export interface ConversationWorkingStateCompactionDependencies {
  getAvailableDiskBytes?: (directoryPath: string) => number;
  beforeValidation?: (temporaryPath: string) => void;
  beforeReopening?: (installedPath: string) => void;
  onPhase?: (phase: ConversationWorkingStateMaintenancePhase) => void;
}

export class ConversationWorkingStateCompactionError extends Error {
  constructor(
    public readonly code: ConversationWorkingStateFailureReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ConversationWorkingStateCompactionError';
  }
}

export function findConversationWorkingStateMaintenanceBlocker(
  db: Database.Database
): ConversationWorkingStateBlockReason | null {
  if (conversationWorkingStateTableExists(db, 'agent_runs') && db.prepare(`SELECT 1 FROM agent_runs
    WHERE status IN ('running', 'waiting_approval') LIMIT 1`).get()) {
    return CONVERSATION_WORKING_STATE_BLOCK_REASONS.ACTIVE_AGENT_RUN;
  }
  if (conversationWorkingStateTableExists(db, 'delegated_agent_runs') && db.prepare(`SELECT 1 FROM delegated_agent_runs
    WHERE status IN ('queued', 'running', 'waiting_approval') LIMIT 1`).get()) {
    return CONVERSATION_WORKING_STATE_BLOCK_REASONS.ACTIVE_DELEGATED_AGENT_RUN;
  }
  if (conversationWorkingStateTableExists(db, 'capability_jobs') && db.prepare(`SELECT 1 FROM capability_jobs
    WHERE status NOT IN ('completed', 'failed', 'canceled') LIMIT 1`).get()) {
    return CONVERSATION_WORKING_STATE_BLOCK_REASONS.ACTIVE_CAPABILITY_JOB;
  }
  return null;
}

function availableDiskBytes(directoryPath: string): number {
  const stats = fs.statfsSync(directoryPath);
  return stats.bavail * stats.bsize;
}

function assertIntegrity(databasePath: string): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('Integrity check did not return ok.');
    }
  } catch (error) {
    throw new ConversationWorkingStateCompactionError(
      CONVERSATION_WORKING_STATE_FAILURE_REASONS.INTEGRITY_CHECK_FAILED,
      'The compacted Conversation Working State did not pass validation.',
      { cause: error }
    );
  } finally {
    db?.close();
  }
}

function reopenWithSaver(databasePath: string): void {
  const saver = SqliteSaver.fromConnString(databasePath);
  try {
    if (saver.db.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('Installed database did not pass integrity validation.');
    }
  } finally {
    saver.db.close();
  }
}

function removeIfPresent(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort cleanup must not mask the maintenance outcome.
  }
}

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error;
    // Some platforms do not permit opening directories; file fsync still applies.
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function hasValidIntegrity(databasePath: string): boolean {
  try {
    assertIntegrity(databasePath);
    return true;
  } catch {
    return false;
  }
}

export function recoverInterruptedConversationWorkingStateCompaction(
  checkpointDatabasePath: string
): boolean {
  const directoryPath = path.dirname(checkpointDatabasePath);
  if (!fs.existsSync(directoryPath)) return false;
  const databaseName = path.basename(checkpointDatabasePath);
  const rollbackPrefix = `${databaseName}.rollback-`;
  const compactPrefix = `${databaseName}.compact-`;
  const directoryEntries = fs.readdirSync(directoryPath);
  const compactPaths = directoryEntries
    .filter((name) => name.startsWith(compactPrefix))
    .map((name) => path.join(directoryPath, name));
  const rollbackPaths = directoryEntries
    .filter((name) => name.startsWith(rollbackPrefix))
    .map((name) => path.join(directoryPath, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (rollbackPaths.length === 0) {
    compactPaths.forEach(removeIfPresent);
    if (compactPaths.length > 0) fsyncDirectory(directoryPath);
    return false;
  }

  if (fs.existsSync(checkpointDatabasePath) && hasValidIntegrity(checkpointDatabasePath)) {
    rollbackPaths.forEach(removeIfPresent);
    compactPaths.forEach(removeIfPresent);
    fsyncDirectory(directoryPath);
    return false;
  }

  const rollbackPath = rollbackPaths.find(hasValidIntegrity);
  if (!rollbackPath) {
    throw new ConversationWorkingStateCompactionError(
      CONVERSATION_WORKING_STATE_FAILURE_REASONS.INTEGRITY_CHECK_FAILED,
      'Conversation Working State recovery could not find a valid rollback candidate.'
    );
  }
  removeIfPresent(checkpointDatabasePath);
  fs.renameSync(rollbackPath, checkpointDatabasePath);
  fsyncDirectory(directoryPath);
  assertIntegrity(checkpointDatabasePath);
  rollbackPaths.filter((candidate) => candidate !== rollbackPath).forEach(removeIfPresent);
  compactPaths.forEach(removeIfPresent);
  return true;
}

export function compactConversationWorkingStateStorage(
  request: ConversationWorkingStateCompactionRequest,
  dependencies: ConversationWorkingStateCompactionDependencies = {}
): ConversationWorkingStateCompactionResult {
  const { checkpointDatabasePath, liveThreadIds } = request;
  const onPhase = dependencies.onPhase ?? (() => undefined);
  const physicalBytesBefore = getConversationWorkingStatePhysicalBytes(checkpointDatabasePath);
  if (!fs.existsSync(checkpointDatabasePath)) {
    return { physicalBytesBefore, physicalBytesAfter: physicalBytesBefore };
  }

  onPhase('reconciling');
  const coherent = new Database(checkpointDatabasePath, { fileMustExist: true });
  try {
    const checkpoint = coherent.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (checkpoint.some((row) => row.busy > 0)) {
      throw new Error('Conversation Working State is busy.');
    }
  } finally {
    coherent.close();
  }
  reconcileOrphanConversationWorkingState({ checkpointDatabasePath, liveThreadIds });

  onPhase('checkingSpace');
  const inspection = inspectConversationWorkingStateStorage(checkpointDatabasePath);
  const requiredBytes = Math.max(
    1024 * 1024,
    inspection.physicalBytes - inspection.estimatedReclaimableBytes
  );
  const getAvailableDiskBytes = dependencies.getAvailableDiskBytes ?? availableDiskBytes;
  if (getAvailableDiskBytes(path.dirname(checkpointDatabasePath)) < requiredBytes) {
    throw new ConversationWorkingStateCompactionError(
      CONVERSATION_WORKING_STATE_FAILURE_REASONS.INSUFFICIENT_DISK_SPACE,
      'There is not enough free disk space to compact Conversation Working State.'
    );
  }

  const uniqueId = randomUUID();
  const temporaryPath = `${checkpointDatabasePath}.compact-${uniqueId}`;
  const rollbackPath = `${checkpointDatabasePath}.rollback-${uniqueId}`;
  let rollbackCreated = false;
  let compactInstalled = false;

  try {
    onPhase('rebuilding');
    const source = new Database(checkpointDatabasePath, { fileMustExist: true });
    try {
      source.prepare('VACUUM INTO ?').run(temporaryPath);
    } finally {
      source.close();
    }

    onPhase('validating');
    dependencies.beforeValidation?.(temporaryPath);
    assertIntegrity(temporaryPath);

    onPhase('replacing');
    const sourceMode = fs.statSync(checkpointDatabasePath).mode;
    fs.chmodSync(temporaryPath, sourceMode);
    fsyncFile(temporaryPath);
    fs.linkSync(checkpointDatabasePath, rollbackPath);
    rollbackCreated = true;
    fs.renameSync(temporaryPath, checkpointDatabasePath);
    compactInstalled = true;
    fsyncDirectory(path.dirname(checkpointDatabasePath));

    onPhase('reopening');
    dependencies.beforeReopening?.(checkpointDatabasePath);
    reopenWithSaver(checkpointDatabasePath);
    fs.rmSync(rollbackPath, { force: true });
    rollbackCreated = false;
    fsyncDirectory(path.dirname(checkpointDatabasePath));

    return {
      physicalBytesBefore,
      physicalBytesAfter: getConversationWorkingStatePhysicalBytes(checkpointDatabasePath),
    };
  } catch (error) {
    if (compactInstalled && rollbackCreated) {
      try {
        removeIfPresent(checkpointDatabasePath);
        fs.renameSync(rollbackPath, checkpointDatabasePath);
        rollbackCreated = false;
        compactInstalled = false;
        fsyncDirectory(path.dirname(checkpointDatabasePath));
      } catch (rollbackError) {
        throw new ConversationWorkingStateCompactionError(
          CONVERSATION_WORKING_STATE_FAILURE_REASONS.COMPACTION_FAILED,
          'Conversation Working State replacement failed and requires startup recovery.',
          { cause: rollbackError }
        );
      }
    }
    if (rollbackCreated && !compactInstalled) {
      removeIfPresent(rollbackPath);
      rollbackCreated = false;
    }
    if (error instanceof ConversationWorkingStateCompactionError) throw error;
    throw new ConversationWorkingStateCompactionError(
      CONVERSATION_WORKING_STATE_FAILURE_REASONS.COMPACTION_FAILED,
      'Conversation Working State compaction failed.',
      { cause: error }
    );
  } finally {
    removeIfPresent(temporaryPath);
    if (!rollbackCreated) removeIfPresent(rollbackPath);
  }
}
