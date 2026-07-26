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
import { Worker } from 'worker_threads';
import {
  conversationWorkingStateTableExists,
  reconcileOrphanConversationWorkingState,
} from './conversation-working-state-reconciliation';

export interface ConversationWorkingStateStorageInspection {
  physicalBytes: number;
  estimatedReclaimableBytes: number;
}

const SQLITE_STORAGE_SUFFIXES = ['', '-wal', '-shm'] as const;

export function getConversationWorkingStatePhysicalBytes(databasePath: string): number {
  return SQLITE_STORAGE_SUFFIXES.reduce((total, suffix) => {
    const filePath = `${databasePath}${suffix}`;
    try {
      return total + fs.statSync(filePath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return total;
      throw error;
    }
  }, 0);
}

export function inspectConversationWorkingStateStorage(
  databasePath: string
): ConversationWorkingStateStorageInspection {
  const physicalBytes = getConversationWorkingStatePhysicalBytes(databasePath);
  if (!fs.existsSync(databasePath) || physicalBytes === 0) {
    return { physicalBytes, estimatedReclaimableBytes: 0 };
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const pageCount = db.pragma('page_count', { simple: true }) as number;
    const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
    const estimatedCompactedBytes = Math.max(0, pageCount - freelistCount) * pageSize;
    const estimatedReclaimableBytes = Math.max(
      0,
      Math.min(physicalBytes, physicalBytes - estimatedCompactedBytes)
    );
    return { physicalBytes, estimatedReclaimableBytes };
  } finally {
    db.close();
  }
}

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
  rebuildTemporaryDatabase?: (sourcePath: string, temporaryPath: string) => void;
  beforeValidation?: (temporaryPath: string) => void;
  createRollback?: (sourcePath: string, rollbackPath: string) => void;
  installTemporaryDatabase?: (temporaryPath: string, installedPath: string) => void;
  reopenDatabase?: (installedPath: string) => void;
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
  const sync = (flags: 'r' | 'r+'): void => {
    const descriptor = fs.openSync(filePath, flags);
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  };
  try {
    sync('r');
  } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') {
      throw error;
    }
    sync('r+');
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

function fsyncDirectoryBestEffort(directoryPath: string): void {
  try {
    fsyncDirectory(directoryPath);
  } catch {
    // A validated live database remains usable; stale artifacts can be retried at next startup.
  }
}

function databaseWasReplaced(
  checkpointDatabasePath: string,
  rollbackPath: string
): boolean {
  try {
    const installed = fs.statSync(checkpointDatabasePath);
    const rollback = fs.statSync(rollbackPath);
    return installed.dev !== rollback.dev || installed.ino !== rollback.ino;
  } catch {
    // Preserve and restore the rollback whenever file identity cannot prove the original is live.
    return true;
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

function rebuildTemporaryDatabase(sourcePath: string, temporaryPath: string): void {
  const source = new Database(sourcePath, { fileMustExist: true });
  try {
    source.prepare('VACUUM INTO ?').run(temporaryPath);
  } finally {
    source.close();
  }
}

function installValidatedRollbackDatabase(
  checkpointDatabasePath: string,
  rollbackFamily: SqliteFileFamily,
  hadRollbackSidecars = false
): void {
  const directoryPath = path.dirname(checkpointDatabasePath);
  if (hadRollbackSidecars) {
    throw recoveryIntegrityError(
      'Conversation Working State recovery cannot atomically restore a rollback with sidecars.'
    );
  }
  try {
    assertIntegrity(rollbackFamily.basePath);
    rollbackFamily.paths.slice(1).forEach(removeIfPresent);
    fsyncFile(rollbackFamily.basePath);
    removeIfPresent(`${checkpointDatabasePath}-wal`);
    removeIfPresent(`${checkpointDatabasePath}-shm`);
    fs.renameSync(rollbackFamily.basePath, checkpointDatabasePath);
    fsyncDirectory(directoryPath);
    assertIntegrity(checkpointDatabasePath);
  } catch (error) {
    if (error instanceof ConversationWorkingStateCompactionError) throw error;
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
    [...rollbackFamilies, ...compactFamilies].forEach(removeFileFamilyBestEffort);
    if (rollbackFamilies.length > 0 || compactFamilies.length > 0) {
      fsyncDirectoryBestEffort(directoryPath);
    }
    return false;
  }

  if (rollbackFamilies.length === 0) {
    if (!hasLiveDatabase && !hasLiveSidecars && compactFamilies.length === 0) return false;
    throw recoveryIntegrityError(
      'Conversation Working State recovery has no validated live or rollback database.'
    );
  }

  const validRollbackCandidates = rollbackFamilies
    .map((family) => ({
      family,
      hadSidecars: family.paths.slice(1).some((filePath) => fs.existsSync(filePath)),
    }))
    .filter(({ family }) => fs.existsSync(family.basePath) && hasValidIntegrity(family.basePath));
  if (validRollbackCandidates.length !== 1) {
    throw recoveryIntegrityError(
      validRollbackCandidates.length === 0
        ? 'Conversation Working State recovery could not find a valid rollback candidate.'
        : 'Conversation Working State recovery found ambiguous rollback candidates.'
    );
  }

  const rollbackCandidate = validRollbackCandidates[0];
  installValidatedRollbackDatabase(
    checkpointDatabasePath,
    rollbackCandidate.family,
    rollbackCandidate.hadSidecars
  );
  [...rollbackFamilies, ...compactFamilies].forEach(removeFileFamilyBestEffort);
  fsyncDirectoryBestEffort(directoryPath);
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
    const rebuild = dependencies.rebuildTemporaryDatabase ?? rebuildTemporaryDatabase;
    rebuild(checkpointDatabasePath, temporaryPath);

    onPhase('validating');
    dependencies.beforeValidation?.(temporaryPath);
    assertIntegrity(temporaryPath);

    onPhase('replacing');
    const sourceMode = fs.statSync(checkpointDatabasePath).mode;
    fs.chmodSync(temporaryPath, sourceMode);
    fsyncFile(temporaryPath);
    fsyncFile(checkpointDatabasePath);
    const createRollback = dependencies.createRollback ?? fs.linkSync;
    createRollback(checkpointDatabasePath, rollbackPath);
    rollbackCreated = true;
    fsyncDirectory(path.dirname(checkpointDatabasePath));
    const installTemporaryDatabase = dependencies.installTemporaryDatabase ?? fs.renameSync;
    installTemporaryDatabase(temporaryPath, checkpointDatabasePath);
    compactInstalled = true;
    fsyncDirectory(path.dirname(checkpointDatabasePath));

    onPhase('reopening');
    const reopenDatabase = dependencies.reopenDatabase ?? reopenWithSaver;
    reopenDatabase(checkpointDatabasePath);
    fs.rmSync(rollbackPath, { force: true });
    rollbackCreated = false;
    fsyncDirectory(path.dirname(checkpointDatabasePath));

    return {
      physicalBytesBefore,
      physicalBytesAfter: getConversationWorkingStatePhysicalBytes(checkpointDatabasePath),
    };
  } catch (error) {
    if (rollbackCreated && (
      compactInstalled || databaseWasReplaced(checkpointDatabasePath, rollbackPath)
    )) {
      try {
        installValidatedRollbackDatabase(checkpointDatabasePath, sqliteFileFamily(rollbackPath));
        removeFileFamilyBestEffort(sqliteFileFamily(rollbackPath));
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

export type ConversationWorkingStateCompactionWorkerResponse =
  | { type: 'phase'; phase: ConversationWorkingStateMaintenancePhase }
  | { type: 'result'; result: ConversationWorkingStateCompactionResult }
  | { type: 'error'; code: ConversationWorkingStateFailureReason; error: string };

export interface ConversationWorkingStateCompactionWorker {
  unref(): void;
  on(event: 'message', listener: (message: ConversationWorkingStateCompactionWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

type CompactionWorkerFactory = (
  workerPath: string,
  request: ConversationWorkingStateCompactionRequest
) => ConversationWorkingStateCompactionWorker;

const createNodeCompactionWorker: CompactionWorkerFactory = (workerPath, request) =>
  new Worker(workerPath, { workerData: request });

export interface ConversationWorkingStateCompactionRunnerContract {
  run(
    request: ConversationWorkingStateCompactionRequest,
    onPhase?: (phase: ConversationWorkingStateMaintenancePhase) => void
  ): Promise<ConversationWorkingStateCompactionResult>;
}

export class ConversationWorkingStateCompactionRunner
implements ConversationWorkingStateCompactionRunnerContract {
  constructor(
    private readonly resolveWorkerPath: () => string,
    private readonly createWorker: CompactionWorkerFactory = createNodeCompactionWorker
  ) {}

  run(
    request: ConversationWorkingStateCompactionRequest,
    onPhase?: (phase: ConversationWorkingStateMaintenancePhase) => void
  ): Promise<ConversationWorkingStateCompactionResult> {
    return new Promise((resolve, reject) => {
      const worker = this.createWorker(this.resolveWorkerPath(), request);
      worker.unref();
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      worker.on('message', (message) => {
        if (message.type === 'phase') {
          if (!settled) onPhase?.(message.phase);
          return;
        }
        settle(() => {
          if (message.type === 'result') {
            resolve(message.result);
          } else {
            reject(new ConversationWorkingStateCompactionError(message.code, message.error));
          }
        });
      });
      worker.once('error', (error) => settle(() => reject(error)));
      worker.once('exit', (code) => {
        settle(() => reject(new Error(
          code === 0
            ? 'Conversation Working State compaction Worker exited without a result.'
            : `Conversation Working State compaction Worker exited with code ${code}.`
        )));
      });
    });
  }
}

/** Default worker-backed runner: the compaction worker bundle sits beside the main bundle. */
export function createConversationWorkingStateCompactionRunner(): ConversationWorkingStateCompactionRunnerContract {
  return new ConversationWorkingStateCompactionRunner(
    () => path.join(__dirname, 'conversation-working-state-compaction-worker.js')
  );
}
