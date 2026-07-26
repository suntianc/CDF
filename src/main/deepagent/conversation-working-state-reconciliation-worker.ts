import { parentPort, workerData } from 'worker_threads';
import {
  reconcileOrphanConversationWorkingState,
  type ConversationWorkingStateReconciliationRequest,
  type ConversationWorkingStateWorkerResponse,
} from './conversation-working-state-reconciliation';

if (!parentPort) {
  throw new Error('Conversation Working State reconciliation requires a Worker parent port.');
}

let response: ConversationWorkingStateWorkerResponse;
try {
  response = {
    ok: true,
    result: reconcileOrphanConversationWorkingState(
      workerData as ConversationWorkingStateReconciliationRequest
    ),
  };
} catch (error) {
  response = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
parentPort.postMessage(response);
