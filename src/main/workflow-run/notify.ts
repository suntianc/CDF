import { BrowserWindow } from 'electron';
import type { WorkflowRunProjectionEvent } from '../../shared/types';

const PROJECTION_EVENT_CHANNEL = 'workflow-run:projection-event';

function firstLiveWindow(): BrowserWindow | undefined {
  const win = BrowserWindow.getAllWindows()[0];
  return win && !win.isDestroyed() ? win : undefined;
}

export function pushProjectionEvent(event: WorkflowRunProjectionEvent): void {
  firstLiveWindow()?.webContents.send(PROJECTION_EVENT_CHANNEL, event);
}

/** Nudge the renderer to reload a Conversation's messages after a workflow state change. */
export function notifyConversationMessagesChanged(sessionId: string): void {
  firstLiveWindow()?.webContents.send('conversation:messages-changed', { sessionId });
}
