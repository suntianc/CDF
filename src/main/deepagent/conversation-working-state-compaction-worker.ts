import { parentPort, workerData } from 'worker_threads';
import {
  compactConversationWorkingStateStorage,
  ConversationWorkingStateCompactionError,
  type ConversationWorkingStateCompactionRequest,
} from './conversation-working-state-compaction';
import { CONVERSATION_WORKING_STATE_FAILURE_REASONS } from '../../shared/conversation-working-state';
import type { ConversationWorkingStateCompactionWorkerResponse } from './conversation-working-state-compaction-runner';

if (!parentPort) {
  throw new Error('Conversation Working State compaction requires a Worker parent port.');
}
const port = parentPort;

try {
  const result = compactConversationWorkingStateStorage(
    workerData as ConversationWorkingStateCompactionRequest,
    {
      onPhase: (phase) => port.postMessage({
        type: 'phase',
        phase,
      } satisfies ConversationWorkingStateCompactionWorkerResponse),
    }
  );
  port.postMessage({
    type: 'result',
    result,
  } satisfies ConversationWorkingStateCompactionWorkerResponse);
} catch (error) {
  port.postMessage({
    type: 'error',
    code: error instanceof ConversationWorkingStateCompactionError
      ? error.code
      : CONVERSATION_WORKING_STATE_FAILURE_REASONS.COMPACTION_FAILED,
    error: error instanceof Error ? error.message : String(error),
  } satisfies ConversationWorkingStateCompactionWorkerResponse);
}
