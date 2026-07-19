import path from 'path';
import db from '../database';
import { conversationWorkingStateLifecycle } from './conversation-working-state';
import { findConversationWorkingStateMaintenanceBlocker } from './conversation-working-state-compaction';
import { ConversationWorkingStateCompactionRunner } from './conversation-working-state-compaction-runner';

const compactionRunner = new ConversationWorkingStateCompactionRunner(
  () => path.join(__dirname, 'conversation-working-state-compaction-worker.js')
);

function readMaintenanceBlocker() {
  return findConversationWorkingStateMaintenanceBlocker(db);
}

function readLiveConversationIds() {
  return (db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>)
    .map((session) => session.id);
}

export function getConversationWorkingStateStorageStatus() {
  const status = conversationWorkingStateLifecycle.getStorageStatus();
  if (status.phase === 'analyzing' || status.phase === 'optimizing') {
    return status;
  }
  return {
    ...status,
    blockedReason: conversationWorkingStateLifecycle.getMaintenanceBlocker(readMaintenanceBlocker),
  };
}

export function compactConversationWorkingState() {
  return conversationWorkingStateLifecycle.compact(
    readMaintenanceBlocker,
    readLiveConversationIds,
    compactionRunner
  );
}
