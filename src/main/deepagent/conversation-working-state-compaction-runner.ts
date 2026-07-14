import { Worker } from 'worker_threads';
import type {
  ConversationWorkingStateFailureReason,
  ConversationWorkingStateMaintenancePhase,
} from '../../shared/conversation-working-state';
import type {
  ConversationWorkingStateCompactionRequest,
  ConversationWorkingStateCompactionResult,
} from './conversation-working-state-compaction';
import { ConversationWorkingStateCompactionError } from './conversation-working-state-compaction';

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

type WorkerFactory = (
  workerPath: string,
  request: ConversationWorkingStateCompactionRequest
) => ConversationWorkingStateCompactionWorker;

const createNodeWorker: WorkerFactory = (workerPath, request) =>
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
    private readonly createWorker: WorkerFactory = createNodeWorker
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
