import { BrowserWindow } from 'electron';
import type { WorkflowRunProjectionEvent } from '../../shared/types';

const PROJECTION_EVENT_CHANNEL = 'workflow-run:projection-event';

export function pushProjectionEvent(event: WorkflowRunProjectionEvent): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(PROJECTION_EVENT_CHANNEL, event);
  }
}
