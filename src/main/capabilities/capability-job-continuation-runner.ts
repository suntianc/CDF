import type Database from 'better-sqlite3';
import type { ChatPayload } from '../../shared/types';
import type { LLMChatEventSender } from '../llm';
import type { ConversationRunStreams } from '../conversation-run-streams';
import type { CapabilityJobContinuationBatch } from './capability-job-continuations';

interface CapabilityJobContinuationRunnerDeps {
  db: Database.Database;
  streams: ConversationRunStreams;
  runChat: (
    sender: LLMChatEventSender,
    requestId: string,
    payload: ChatPayload,
  ) => Promise<void>;
  onMessagesChanged: (sessionId: string) => void;
  now?: () => number;
}

export function createCapabilityJobContinuationRunner(
  deps: CapabilityJobContinuationRunnerDeps,
): (batch: CapabilityJobContinuationBatch) => Promise<void> {
  return async (batch) => {
    const requestId = `background-continuation:${batch.batchId}`;
    const messageId = `background-continuation-output:${batch.batchId}`;
    const stream = deps.streams.begin({
      sessionId: batch.sessionId,
      requestId,
      messageId,
      origin: 'background-capability-continuation',
    });

    try {
      await deps.runChat(stream.sender, requestId, {
        projectId: batch.projectId,
        sessionId: batch.sessionId,
        agentId: batch.agentId,
        message: {
          id: `background-continuation-input:${batch.batchId}`,
          content: JSON.stringify({
            type: 'background_capability_job_continuation',
            events: batch.events,
            instruction:
              'Present these already-durable local results. Do not recreate, re-query, or re-download provider jobs.',
          }),
        },
        // A deliberately unmatched allowlist prevents replay from invoking
        // provider or mutation tools for already-durable completion events.
        overrides: { allowedTools: ['__background_continuation_no_tools__'] },
      });

      const assistantText = deps.streams.getActive(batch.sessionId)?.content ?? '';
      const messageInserted = deps.db.transaction(() => {
        const completedAt = (deps.now ?? Date.now)();
        deps.db.prepare(`INSERT OR IGNORE INTO capability_job_continuation_batches (batch_id, completed_at)
          VALUES (?, ?)`).run(batch.batchId, completedAt);
        if (!assistantText.trim()) return false;
        const result = deps.db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, 'assistant', ?, ?)`)
          .run(messageId, batch.sessionId, assistantText, completedAt);
        return result.changes === 1;
      })();

      stream.commit();
      if (messageInserted) deps.onMessagesChanged(batch.sessionId);
    } catch (error) {
      stream.fail();
      throw error;
    }
  };
}
