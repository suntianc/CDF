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
  beforeRebuild?: (sourcePath: string, temporaryPath: string) => void;
  beforeValidation?: (temporaryPath: string) => void;
  beforeRollbackCreation?: (sourcePath: string, rollbackPath: string) => void;
  beforeInstall?: (temporaryPath: string, installedPath: string) => void;
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

const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm'] as const;

interface SqliteFileFamily {
  basePath: string;
  paths: string[];
}

function sqliteFileFamily(basePath: string): SqliteFileFamily {
  return {
    basePath,
    paths: SQLITE_FILE_SUFFIXES.map((suffix) => `${basePath}${suffix}`),
  };
}

function listMaintenanceFileFamilies(
  directoryPath: string,
  databaseName: string,
  kind: 'compact' | 'rollback'
): SqliteFileFamily[] {
  const prefix = `${databaseName}.${kind}-`;
  const baseNames = new Set<string>();
  for (const entry of fs.readdirSync(directoryPath)) {
    if (!entry.startsWith(prefix)) continue;
    const sidecarSuffix = SQLITE_FILE_SUFFIXES.slice(1).find((suffix) => entry.endsWith(suffix));
    baseNames.add(sidecarSuffix ? entry.slice(0, -sidecarSuffix.length) : entry);
  }
  return [...baseNames]
    .sort()
    .map((baseName) => sqliteFileFamily(path.join(directoryPath, baseName)));
}

function removeIfPresent(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

function removeFileFamily(family: SqliteFileFamily): void {
  family.paths.forEach(removeIfPresent);
}

function removeFileFamilyBestEffort(family: SqliteFileFamily): void {
  for (const filePath of family.paths) {
    try {
      removeIfPresent(filePath);
    } catch {
      // Best-effort cleanup must not mask the maintenance outcome.
    }
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

function recoveryIntegrityError(message: string, cause?: unknown): ConversationWorkingStateCompactionError {
  return new ConversationWorkingStateCompactionError(
    CONVERSATION_WORKING_STATE_FAILURE_REASONS.INTEGRITY_CHECK_FAILED,
    message,
    cause === undefined ? undefined : { cause }
  );
}

function rebuildValidatedDatabase(sourcePath: string, temporaryPath: string): void {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.prepare('VACUUM INTO ?').run(temporaryPath);
  } finally {
    source.close();
  }
  assertIntegrity(temporaryPath);
  fsyncFile(temporaryPath);
}

function installValidatedRecoveryDatabase(
  checkpointDatabasePath: string,
  rollbackPath: string
): void {
  const directoryPath = path.dirname(checkpointDatabasePath);
  const recoveryPath = `${checkpointDatabasePath}.compact-recovery-${randomUUID()}`;
  try {
    rebuildValidatedDatabase(rollbackPath, recoveryPath);
    removeIfPresent(`${checkpointDatabasePath}-wal`);
    removeIfPresent(`${checkpointDatabasePath}-shm`);
    fs.renameSync(recoveryPath, checkpointDatabasePath);
    fsyncDirectory(directoryPath);
    assertIntegrity(checkpointDatabasePath);
  } catch (error) {
    throw recoveryIntegrityError(
      'Conversation Working State recovery could not restore the validated rollback database.',
      error
    );
  }
}

export function recoverInterruptedConversationWorkingStateCompaction(
  checkpointDatabasePath: string
): boolean {
  const directoryPath = path.dirname(checkpointDatabasePath);
  if (!fs.existsSync(directoryPath)) return false;
  const databaseName = path.basename(checkpointDatabasePath);
  const compactFamilies = listMaintenanceFileFamilies(directoryPath, databaseName, 'compact');
  const rollbackFamilies = listMaintenanceFileFamilies(directoryPath, databaseName, 'rollback');
  const hasLiveDatabase = fs.existsSync(checkpointDatabasePath);
  const hasLiveSidecars = fs.existsSync(`${checkpointDatabasePath}-wal`)
    || fs.existsSync(`${checkpointDatabasePath}-shm`);
  const liveDatabaseIsValid = hasLiveDatabase && hasValidIntegrity(checkpointDatabasePath);

  if (liveDatabaseIsValid) {
    [...rollbackFamilies, ...compactFamilies].forEach(removeFileFamily);
    if (rollbackFamilies.length > 0 || compactFamilies.length > 0) {
      fsyncDirectory(directoryPath);
    }
    return false;
  }

  if (rollbackFamilies.length === 0) {
    if (!hasLiveDatabase && !hasLiveSidecars && compactFamilies.length === 0) return false;
    throw recoveryIntegrityError(
      'Conversation Working State recovery has no validated live or rollback database.'
    );
  }

  const validRollbackFamilies = rollbackFamilies.filter(
    ({ basePath }) => fs.existsSync(basePath) && hasValidIntegrity(basePath)
  );
  if (validRollbackFamilies.length !== 1) {
    throw recoveryIntegrityError(
      validRollbackFamilies.length === 0
        ? 'Conversation Working State recovery could not find a valid rollback candidate.'
        : 'Conversation Working State recovery found ambiguous rollback candidates.'
    );
  }

  installValidatedRecoveryDatabase(
    checkpointDatabasePath,
    validRollbackFamilies[0].basePath
  );
  [...rollbackFamilies, ...compactFamilies].forEach(removeFileFamily);
  fsyncDirectory(directoryPath);
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
    dependencies.beforeRebuild?.(checkpointDatabasePath, temporaryPath);
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
    fsyncFile(checkpointDatabasePath);
    dependencies.beforeRollbackCreation?.(checkpointDatabasePath, rollbackPath);
    fs.linkSync(checkpointDatabasePath, rollbackPath);
    rollbackCreated = true;
    fsyncDirectory(path.dirname(checkpointDatabasePath));
    dependencies.beforeInstall?.(temporaryPath, checkpointDatabasePath);
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
        installValidatedRecoveryDatabase(checkpointDatabasePath, rollbackPath);
        removeFileFamily(sqliteFileFamily(rollbackPath));
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
      removeFileFamilyBestEffort(sqliteFileFamily(rollbackPath));
      rollbackCreated = false;
    }
    if (error instanceof ConversationWorkingStateCompactionError) throw error;
    throw new ConversationWorkingStateCompactionError(
      CONVERSATION_WORKING_STATE_FAILURE_REASONS.COMPACTION_FAILED,
      'Conversation Working State compaction failed.',
      { cause: error }
    );
  } finally {
    removeFileFamilyBestEffort(sqliteFileFamily(temporaryPath));
    if (!rollbackCreated) removeFileFamilyBestEffort(sqliteFileFamily(rollbackPath));
  }
}
