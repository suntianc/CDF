import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint';
import {
  CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED,
  STARTUP_RECONCILIATION_FAILED,
  ConversationWorkingStateMaintenanceError,
  createConversationWorkingStateLifecycle,
  type ConversationWorkingStateLifecycle,
} from './conversation-working-state';

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

    expect(lifecycle.getStorageStatus()).toEqual({
      phase: 'analyzing',
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
    expect(lifecycle.getStorageStatus()).toEqual({
      phase: 'normal',
      failureReason: null,
    });
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
    expect(lifecycle.getStorageStatus()).toEqual({
      phase: 'failed',
      failureReason: STARTUP_RECONCILIATION_FAILED,
    });
    expect(lifecycle.acquireSaver()).toBeDefined();
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
