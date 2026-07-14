import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import {
  CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED,
  STARTUP_RECONCILIATION_FAILED,
  ConversationWorkingStateMaintenanceError,
  createConversationWorkingStateLifecycle,
  type ConversationWorkingStateLifecycle,
} from './conversation-working-state';
import type { ConversationWorkingStateCompactionRunnerContract } from './conversation-working-state-compaction-runner';
import {
  compactConversationWorkingStateStorage,
  type ConversationWorkingStateCompactionDependencies,
} from './conversation-working-state-compaction';

function checkpoint(id: string, value: string): Checkpoint {
  return {
    v: 4,
    id,
    ts: '2026-07-13T00:00:00.000Z',
    channel_values: { messages: [value] },
    channel_versions: { messages: 1 },
    versions_seen: {},
  };
}

const metadata: CheckpointMetadata = {
  source: 'input',
  step: -1,
  parents: {},
};

describe('ConversationWorkingStateLifecycle', () => {
  let tempDir: string;
  let lifecycle: ConversationWorkingStateLifecycle;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-working-state-'));
    lifecycle = createConversationWorkingStateLifecycle(
      () => path.join(tempDir, 'deepagents-checkpoints.db')
    );
  });

  afterEach(() => {
    lifecycle.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reuses one saver between runtime acquisitions', () => {
    const first = lifecycle.acquireSaver();
    const second = lifecycle.acquireSaver();

    expect(second).toBe(first);
  });

  it('blocks new runtime acquisition without invalidating an acquired saver', async () => {
    const acquiredSaver = lifecycle.acquireSaver();
    await acquiredSaver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-maintenance', 'retained'),
      metadata
    );

    lifecycle.enterMaintenance();

    expect(() => lifecycle.acquireSaver()).toThrowError(
      expect.objectContaining<Partial<ConversationWorkingStateMaintenanceError>>({
        name: 'ConversationWorkingStateMaintenanceError',
        code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED,
        recoverable: true,
      })
    );
    await expect(acquiredSaver.getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-before-maintenance' } });

    lifecycle.leaveMaintenance();
    expect(lifecycle.acquireSaver()).toBe(acquiredSaver);
  });

  it('deletes one Conversation thread without affecting another', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-a', checkpoint_ns: '' } },
      checkpoint('checkpoint-a', 'a'),
      metadata
    );
    await saver.put(
      { configurable: { thread_id: 'conversation-b', checkpoint_ns: '' } },
      checkpoint('checkpoint-b', 'b'),
      metadata
    );

    await lifecycle.deleteThread('conversation-a');

    await expect(saver.getTuple({
      configurable: { thread_id: 'conversation-a', checkpoint_ns: '' },
    })).resolves.toBeUndefined();
    await expect(saver.getTuple({
      configurable: { thread_id: 'conversation-b', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-b' } });
  });

  it('allows lifecycle cleanup while runtime acquisition is maintenance-locked', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-1', 'retained'),
      metadata
    );
    lifecycle.enterMaintenance();

    await lifecycle.deleteThread('conversation-1');

    await expect(saver.getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toBeUndefined();
  });

  it('gates runtime acquisition until startup reconciliation succeeds', async () => {
    let resolveReconciliation!: (value: { deletedThreadCount: number }) => void;
    const runner = {
      run: vi.fn(() => new Promise<{ deletedThreadCount: number }>((resolve) => {
        resolveReconciliation = resolve;
      })),
    };
    const reconciliation = lifecycle.reconcileOrphansAtStartup(
      () => ['conversation-1'],
      runner
    );

    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'analyzing',
      maintenancePhase: 'reconciling',
      blockedReason: null,
      failureReason: null,
    });
    expect(() => lifecycle.acquireSaver()).toThrowError(
      expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
    );
    expect(runner.run).toHaveBeenCalledWith({
      checkpointDatabasePath: path.join(tempDir, 'deepagents-checkpoints.db'),
      liveThreadIds: ['conversation-1'],
    });

    resolveReconciliation({ deletedThreadCount: 2 });
    await expect(reconciliation).resolves.toEqual({ ok: true, deletedThreadCount: 2 });
    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'normal',
      maintenancePhase: null,
      blockedReason: null,
      failureReason: null,
    });
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('restores interrupted maintenance before orphan reconciliation observes the database', async () => {
    const databasePath = path.join(tempDir, 'deepagents-checkpoints.db');
    const rollbackPath = `${databasePath}.rollback-interrupted`;
    const rollback = new Database(rollbackPath);
    rollback.exec('CREATE TABLE recovery_marker (value TEXT); INSERT INTO recovery_marker VALUES (\'restored\')');
    rollback.close();
    const runner = {
      run: vi.fn(async ({ checkpointDatabasePath }: { checkpointDatabasePath: string }) => {
        const recovered = new Database(checkpointDatabasePath, { readonly: true });
        try {
          expect(recovered.prepare('SELECT value FROM recovery_marker').get())
            .toEqual({ value: 'restored' });
        } finally {
          recovered.close();
        }
        return { deletedThreadCount: 0 };
      }),
    };

    await expect(lifecycle.reconcileOrphansAtStartup(() => [], runner))
      .resolves.toEqual({ ok: true, deletedThreadCount: 0 });

    expect(runner.run).toHaveBeenCalledOnce();
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('fails closed after ambiguous startup recovery but releases maintenance for a deterministic retry', async () => {
    const databasePath = path.join(tempDir, 'deepagents-checkpoints.db');
    const firstRollbackPath = `${databasePath}.rollback-first`;
    const secondRollbackPath = `${databasePath}.rollback-second`;
    for (const [rollbackPath, value] of [
      [firstRollbackPath, 'first'],
      [secondRollbackPath, 'second'],
    ] as const) {
      const rollback = new Database(rollbackPath);
      rollback.exec(`CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES ('${value}')`);
      rollback.close();
    }
    const runner = { run: vi.fn(async () => ({ deletedThreadCount: 0 })) };

    const failed = await lifecycle.reconcileOrphansAtStartup(() => [], runner);

    expect(failed).toMatchObject({
      ok: false,
      failureReason: STARTUP_RECONCILIATION_FAILED,
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(() => lifecycle.acquireSaver()).toThrowError(
      expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
    );

    fs.rmSync(secondRollbackPath);
    await expect(lifecycle.reconcileOrphansAtStartup(() => [], runner))
      .resolves.toEqual({ ok: true, deletedThreadCount: 0 });
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('records startup reconciliation failure and always releases the runtime gate', async () => {
    const failure = new Error('database busy');
    const reconciliation = lifecycle.reconcileOrphansAtStartup(
      () => ['conversation-1'],
      { run: vi.fn(async () => { throw failure; }) }
    );

    await expect(reconciliation).resolves.toEqual({
      ok: false,
      failureReason: STARTUP_RECONCILIATION_FAILED,
      error: failure,
    });
    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'failed',
      maintenancePhase: null,
      blockedReason: null,
      failureReason: STARTUP_RECONCILIATION_FAILED,
    });
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('reports live and persisted maintenance blockers without retaining stale activity', () => {
    let persistedBlocker: 'ACTIVE_DELEGATED_AGENT_RUN' | null = 'ACTIVE_DELEGATED_AGENT_RUN';
    const readPersistedBlocker = () => persistedBlocker;

    expect(lifecycle.getMaintenanceBlocker(readPersistedBlocker))
      .toBe('ACTIVE_DELEGATED_AGENT_RUN');

    const releaseRuntime = lifecycle.beginRuntimeUse();
    expect(lifecycle.getMaintenanceBlocker(readPersistedBlocker)).toBe('ACTIVE_AGENT_RUN');
    releaseRuntime();

    persistedBlocker = null;
    expect(lifecycle.getMaintenanceBlocker(readPersistedBlocker)).toBeNull();

    const releaseCapabilityJob = lifecycle.beginCapabilityJobUse();
    expect(lifecycle.getMaintenanceBlocker(readPersistedBlocker)).toBe('ACTIVE_CAPABILITY_JOB');
    releaseCapabilityJob();
    expect(lifecycle.getMaintenanceBlocker(readPersistedBlocker)).toBeNull();
  });

  it('rejects compaction while a runtime is initializing before its run record exists', async () => {
    const releaseRuntime = lifecycle.beginRuntimeUse();
    const runner: ConversationWorkingStateCompactionRunnerContract = { run: vi.fn() };

    await expect(lifecycle.compact(
      () => null,
      () => [],
      runner
    )).resolves.toEqual({ ok: false, blockedReason: 'ACTIVE_AGENT_RUN' });

    expect(runner.run).not.toHaveBeenCalled();
    releaseRuntime();
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('rejects compaction while a Background Capability Job is being created', async () => {
    const releaseJob = lifecycle.beginCapabilityJobUse();
    const runner: ConversationWorkingStateCompactionRunnerContract = { run: vi.fn() };

    await expect(lifecycle.compact(
      () => null,
      () => [],
      runner
    )).resolves.toEqual({ ok: false, blockedReason: 'ACTIVE_CAPABILITY_JOB' });

    expect(runner.run).not.toHaveBeenCalled();
    releaseJob();
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('rejects compaction without closing or mutating an acquired saver while work is active', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-active', 'retained'),
      metadata
    );
    const runner: ConversationWorkingStateCompactionRunnerContract = { run: vi.fn() };

    await expect(lifecycle.compact(
      () => 'ACTIVE_DELEGATED_AGENT_RUN',
      () => ['conversation-1'],
      runner
    )).resolves.toEqual({ ok: false, blockedReason: 'ACTIVE_DELEGATED_AGENT_RUN' });

    expect(runner.run).not.toHaveBeenCalled();
    expect(lifecycle.acquireSaver()).toBe(saver);
    await expect(saver.getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-active' } });
    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'normal',
      blockedReason: 'ACTIVE_DELEGATED_AGENT_RUN',
      failureReason: null,
    });
  });

  it('closes coherently, reports real phases, and lazily reopens after compaction', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-compaction', 'retained'),
      metadata
    );
    const physicalBytesBefore = lifecycle.getStorageStatus().physicalBytes;
    let saverDuringRun: ReturnType<ConversationWorkingStateLifecycle['acquireSaver']> | undefined;
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: vi.fn(async (request, onPhase) => {
        expect(request.liveThreadIds).toEqual(['conversation-1']);
        const walPath = `${request.checkpointDatabasePath}-wal`;
        expect(fs.existsSync(walPath) ? fs.statSync(walPath).size : 0).toBe(0);
        expect(() => lifecycle.acquireSaver()).toThrowError(
          expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
        );
        await expect(lifecycle.deleteThread('conversation-1')).rejects.toMatchObject({
          code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED,
        });
        expect(() => lifecycle.assertConversationDeletionAllowed()).toThrowError(
          expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
        );
        onPhase?.('rebuilding');
        const movedPath = `${request.checkpointDatabasePath}.worker-owned`;
        fs.renameSync(request.checkpointDatabasePath, movedPath);
        expect(lifecycle.getStorageStatus()).toMatchObject({
          phase: 'optimizing',
          maintenancePhase: 'rebuilding',
          physicalBytes: physicalBytesBefore,
        });
        fs.renameSync(movedPath, request.checkpointDatabasePath);
        saverDuringRun = saver;
        return { physicalBytesBefore: 4096, physicalBytesAfter: 2048 };
      }),
    };

    await expect(lifecycle.compact(
      () => null,
      () => ['conversation-1'],
      runner
    )).resolves.toEqual({ ok: true, physicalBytesBefore: 4096, physicalBytesAfter: 2048 });

    const reopened = lifecycle.acquireSaver();
    expect(reopened).not.toBe(saverDuringRun);
    await expect(reopened.getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-before-compaction' } });
    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'normal',
      maintenancePhase: null,
      blockedReason: null,
      failureReason: null,
    });
  });

  it('keeps the maintenance lock owned by the first concurrent compaction', async () => {
    let finishCompaction!: () => void;
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: vi.fn(() => new Promise<{ physicalBytesBefore: number; physicalBytesAfter: number }>((resolve) => {
        finishCompaction = () => resolve({ physicalBytesBefore: 0, physicalBytesAfter: 0 });
      })),
    };
    const first = lifecycle.compact(() => null, () => [], runner);
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce());

    await expect(lifecycle.compact(() => null, () => [], runner)).rejects.toMatchObject({
      code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED,
    });
    expect(() => lifecycle.acquireSaver()).toThrowError(
      expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
    );

    finishCompaction();
    await expect(first).resolves.toEqual({
      ok: true,
      physicalBytesBefore: 0,
      physicalBytesAfter: 0,
    });
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('recovers Worker interruption artifacts before releasing the maintenance lock', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-worker-exit', 'retained'),
      metadata
    );
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: vi.fn(async ({ checkpointDatabasePath }) => {
        const source = new Database(checkpointDatabasePath, { readonly: true });
        source.prepare('VACUUM INTO ?').run(`${checkpointDatabasePath}.compact-worker-exit`);
        source.close();
        throw new Error('Worker exited during rebuild');
      }),
    };

    await expect(lifecycle.compact(
      () => null,
      () => ['conversation-1'],
      runner
    )).resolves.toMatchObject({ ok: false, failureReason: 'COMPACTION_FAILED' });

    expect(fs.readdirSync(tempDir).some((name) => name.includes('.compact-'))).toBe(false);
    await expect(lifecycle.acquireSaver().getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-before-worker-exit' } });
  });

  it('restores the prior database after a Worker exits with a corrupt replacement installed', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-replacement', 'retained'),
      metadata
    );
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: vi.fn(async ({ checkpointDatabasePath }) => {
        fs.copyFileSync(checkpointDatabasePath, `${checkpointDatabasePath}.rollback-worker-exit`);
        fs.writeFileSync(checkpointDatabasePath, 'corrupt replacement');
        throw new Error('Worker exited after replacement');
      }),
    };

    await expect(lifecycle.compact(
      () => null,
      () => ['conversation-1'],
      runner
    )).resolves.toMatchObject({ ok: false, failureReason: 'COMPACTION_FAILED' });

    await expect(lifecycle.acquireSaver().getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-before-replacement' } });
  });

  it('fails closed when Worker interruption recovery is ambiguous', async () => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-ambiguous-recovery', 'retained'),
      metadata
    );
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: vi.fn(async ({ checkpointDatabasePath }) => {
        fs.copyFileSync(checkpointDatabasePath, `${checkpointDatabasePath}.rollback-first`);
        fs.copyFileSync(checkpointDatabasePath, `${checkpointDatabasePath}.rollback-second`);
        fs.writeFileSync(checkpointDatabasePath, 'corrupt replacement');
        throw new Error('Worker exited after ambiguous replacement');
      }),
    };

    await expect(lifecycle.compact(
      () => null,
      () => ['conversation-1'],
      runner
    )).resolves.toMatchObject({ ok: false, failureReason: 'INTEGRITY_CHECK_FAILED' });

    expect(() => lifecycle.acquireSaver()).toThrowError(
      expect.objectContaining({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED })
    );
    const retryRunner: ConversationWorkingStateCompactionRunnerContract = { run: vi.fn() };
    await expect(lifecycle.compact(() => null, () => ['conversation-1'], retryRunner))
      .rejects.toMatchObject({ code: CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED });
    expect(retryRunner.run).not.toHaveBeenCalled();
  });

  it.each([
    ['free-space check', {
      getAvailableDiskBytes: () => 0,
    }, 'INSUFFICIENT_DISK_SPACE'],
    ['temporary rebuild', {
      rebuildTemporaryDatabase: () => { throw new Error('rebuild failed'); },
    }, 'COMPACTION_FAILED'],
    ['integrity validation', {
      beforeValidation: (temporaryPath: string) => fs.writeFileSync(temporaryPath, 'invalid'),
    }, 'INTEGRITY_CHECK_FAILED'],
    ['original-to-rollback replacement', {
      createRollback: () => { throw new Error('rollback failed'); },
    }, 'COMPACTION_FAILED'],
    ['temporary-to-live replacement', {
      installTemporaryDatabase: (temporaryPath: string, installedPath: string) => {
        fs.renameSync(temporaryPath, installedPath);
        throw new Error('install failed after rename');
      },
    }, 'COMPACTION_FAILED'],
    ['reopened-database validation', {
      reopenDatabase: () => { throw new Error('reopen failed'); },
    }, 'COMPACTION_FAILED'],
  ] as Array<[
    string,
    ConversationWorkingStateCompactionDependencies,
    string,
  ]>)('releases maintenance with readable state after %s failure', async (
    _window,
    dependencies,
    expectedFailureReason
  ) => {
    const saver = lifecycle.acquireSaver();
    await saver.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-before-failure', 'retained'),
      metadata
    );
    const runner: ConversationWorkingStateCompactionRunnerContract = {
      run: async (request) => compactConversationWorkingStateStorage(request, dependencies),
    };

    await expect(lifecycle.compact(
      () => null,
      () => ['conversation-1'],
      runner
    )).resolves.toMatchObject({ ok: false, failureReason: expectedFailureReason });

    await expect(lifecycle.acquireSaver().getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-before-failure' } });
  });

  it('records a stable compaction failure and always releases the maintenance lock', async () => {
    const error = Object.assign(new Error('disk full'), { code: 'INSUFFICIENT_DISK_SPACE' });

    await expect(lifecycle.compact(
      () => null,
      () => [],
      { run: vi.fn(async () => { throw error; }) }
    )).resolves.toEqual({
      ok: false,
      failureReason: 'INSUFFICIENT_DISK_SPACE',
      error,
    });

    expect(lifecycle.getStorageStatus()).toMatchObject({
      phase: 'failed',
      maintenancePhase: null,
      failureReason: 'INSUFFICIENT_DISK_SPACE',
    });
    expect(lifecycle.acquireSaver()).toBeDefined();
  });

  it('reports a stable inspection failure without exposing the underlying file error', () => {
    fs.writeFileSync(path.join(tempDir, 'deepagents-checkpoints.db'), 'not sqlite');

    expect(lifecycle.getStorageStatus()).toEqual({
      phase: 'failed',
      maintenancePhase: null,
      physicalBytes: 10,
      estimatedReclaimableBytes: 0,
      blockedReason: null,
      failureReason: 'STORAGE_INSPECTION_FAILED',
    });
  });

  it('lazily reopens the saver without losing the checkpoint chain', async () => {
    const first = lifecycle.acquireSaver();
    const firstConfig = await first.put(
      { configurable: { thread_id: 'conversation-1', checkpoint_ns: '' } },
      checkpoint('checkpoint-1', 'first'),
      metadata
    );
    await first.put(
      firstConfig,
      checkpoint('checkpoint-2', 'second'),
      { ...metadata, source: 'loop', step: 0 }
    );

    lifecycle.close();
    const reopened = lifecycle.acquireSaver();

    expect(reopened).not.toBe(first);
    await expect(reopened.getTuple({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })).resolves.toMatchObject({ checkpoint: { id: 'checkpoint-2' } });

    const checkpointIds: string[] = [];
    for await (const tuple of reopened.list({
      configurable: { thread_id: 'conversation-1', checkpoint_ns: '' },
    })) {
      checkpointIds.push(tuple.checkpoint.id);
    }
    expect(checkpointIds).toEqual(['checkpoint-2', 'checkpoint-1']);
  });
});
