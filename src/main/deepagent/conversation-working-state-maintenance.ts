import path from 'path';
import db from '../database';
import { conversationWorkingStateLifecycle } from './conversation-working-state';
import { findConversationWorkingStateMaintenanceBlocker } from './conversation-working-state-compaction';
import { ConversationWorkingStateCompactionRunner } from './conversation-working-state-compaction-runner';

const compactionRunner = new ConversationWorkingStateCompactionRunner(
  () => path.join(__dirname, 'conversation-working-state-compaction-worker.js')
);

export function compactConversationWorkingState() {
  return conversationWorkingStateLifecycle.compact(
    () => findConversationWorkingStateMaintenanceBlocker(db),
    () => (db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>)
      .map((session) => session.id),
    compactionRunner
  );
}
