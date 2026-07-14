import { Worker } from 'worker_threads';
import type {
  ConversationWorkingStateReconciliationRequest,
  ConversationWorkingStateReconciliationResult,
} from './conversation-working-state-reconciliation';

export type ConversationWorkingStateWorkerResponse =
  | { ok: true; result: ConversationWorkingStateReconciliationResult }
  | { ok: false; error: string };

export interface ConversationWorkingStateWorker {
  once(event: 'message', listener: (message: ConversationWorkingStateWorkerResponse) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

type WorkerFactory = (
  workerPath: string,
  request: ConversationWorkingStateReconciliationRequest
) => ConversationWorkingStateWorker;

const createNodeWorker: WorkerFactory = (workerPath, request) =>
  new Worker(workerPath, { workerData: request });

export interface ConversationWorkingStateReconciliationRunner {
  run(
    request: ConversationWorkingStateReconciliationRequest
  ): Promise<ConversationWorkingStateReconciliationResult>;
}

export class ConversationWorkingStateWorkerRunner
implements ConversationWorkingStateReconciliationRunner {
  constructor(
    private readonly resolveWorkerPath: () => string,
    private readonly createWorker: WorkerFactory = createNodeWorker
  ) {}

  run(
    request: ConversationWorkingStateReconciliationRequest
  ): Promise<ConversationWorkingStateReconciliationResult> {
    return new Promise((resolve, reject) => {
      const worker = this.createWorker(this.resolveWorkerPath(), request);
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      worker.once('message', (message) => {
        settle(() => {
          if (message.ok) resolve(message.result);
          else reject(new Error(message.error));
        });
      });
      worker.once('error', (error) => settle(() => reject(error)));
      worker.once('exit', (code) => {
        settle(() => reject(new Error(
          code === 0
            ? 'Conversation Working State Worker exited without a result.'
            : `Conversation Working State Worker exited with code ${code}.`
        )));
      });
    });
  }
}
