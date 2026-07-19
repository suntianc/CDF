import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationWorkingStateCompactionRunner,
  type ConversationWorkingStateCompactionWorker,
} from './conversation-working-state-compaction-runner';

class FakeWorker extends EventEmitter implements ConversationWorkingStateCompactionWorker {
  unref(): void {}
}

const request = {
  checkpointDatabasePath: '/tmp/deepagents-checkpoints.db',
  liveThreadIds: ['conversation-1'],
};

describe('ConversationWorkingStateCompactionRunner', () => {
  it('runs compaction in a Worker and forwards real maintenance phases', async () => {
    const worker = new FakeWorker();
    const onPhase = vi.fn();
    const runner = new ConversationWorkingStateCompactionRunner(
      () => '/app/compaction-worker.js',
      (_workerPath, workerRequest) => {
        expect(workerRequest).toEqual(request);
        queueMicrotask(() => {
          worker.emit('message', { type: 'phase', phase: 'rebuilding' });
          worker.emit('message', {
            type: 'result',
            result: { physicalBytesBefore: 4096, physicalBytesAfter: 2048 },
          });
        });
        return worker;
      }
    );

    await expect(runner.run(request, onPhase)).resolves.toEqual({
      physicalBytesBefore: 4096,
      physicalBytesAfter: 2048,
    });
    expect(onPhase).toHaveBeenCalledWith('rebuilding');
  });

  it('preserves a stable Worker failure code', async () => {
    const worker = new FakeWorker();
    const runner = new ConversationWorkingStateCompactionRunner(
      () => '/app/compaction-worker.js',
      () => {
        queueMicrotask(() => worker.emit('message', {
          type: 'error',
          code: 'INSUFFICIENT_DISK_SPACE',
          error: 'not enough room',
        }));
        return worker;
      }
    );

    await expect(runner.run(request)).rejects.toMatchObject({
      code: 'INSUFFICIENT_DISK_SPACE',
      message: 'not enough room',
    });
  });
});
