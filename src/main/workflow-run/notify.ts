import { BrowserWindow } from 'electron';
import type { WorkflowRunProjectionEvent } from '../../shared/types';
import { typedSend } from '../typed-ipc';

function firstLiveWindow(): BrowserWindow | undefined {
  const win = BrowserWindow.getAllWindows()[0];
  return win && !win.isDestroyed() ? win : undefined;
}

export function pushProjectionEvent(event: WorkflowRunProjectionEvent): void {
  const win = firstLiveWindow();
  if (win) typedSend(win.webContents, 'workflow-run:projection-event', event);
}

/** Nudge the renderer to reload a Conversation's messages after a workflow state change. */
export function notifyConversationMessagesChanged(sessionId: string): void {
  const win = firstLiveWindow();
  if (win) typedSend(win.webContents, 'conversation:messages-changed', { sessionId });
}
