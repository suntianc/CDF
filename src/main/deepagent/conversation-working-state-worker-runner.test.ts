import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  ConversationWorkingStateWorkerRunner,
  type ConversationWorkingStateWorker,
} from './conversation-working-state-worker-runner';

class FakeWorker extends EventEmitter implements ConversationWorkingStateWorker {}

const request = {
  checkpointDatabasePath: '/tmp/deepagents-checkpoints.db',
  liveThreadIds: ['conversation-1'],
};

describe('ConversationWorkingStateWorkerRunner', () => {
  it('passes the reconciliation request to the Worker and returns its result', async () => {
    const worker = new FakeWorker();
    let receivedPath = '';
    let receivedRequest: unknown;
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      (workerPath, workerRequest) => {
        receivedPath = workerPath;
        receivedRequest = workerRequest;
        queueMicrotask(() => worker.emit('message', {
          ok: true,
          result: { deletedThreadCount: 2 },
        }));
        return worker;
      }
    );

    await expect(runner.run(request)).resolves.toEqual({ deletedThreadCount: 2 });
    expect(receivedPath).toBe('/app/reconciliation-worker.js');
    expect(receivedRequest).toEqual(request);
  });

  it('rejects a structured Worker failure', async () => {
    const worker = new FakeWorker();
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      () => {
        queueMicrotask(() => worker.emit('message', { ok: false, error: 'database busy' }));
        return worker;
      }
    );

    await expect(runner.run(request)).rejects.toThrow('database busy');
  });

  it('rejects when the Worker exits before reporting a result', async () => {
    const worker = new FakeWorker();
    const runner = new ConversationWorkingStateWorkerRunner(
      () => '/app/reconciliation-worker.js',
      () => {
        queueMicrotask(() => worker.emit('exit', 1));
        return worker;
      }
    );

    await expect(runner.run(request)).rejects.toThrow('exited with code 1');
  });
});
