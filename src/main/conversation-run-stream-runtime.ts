import { BrowserWindow } from 'electron';
import { typedSend } from './typed-ipc';
import { ConversationRunStreams } from './conversation-run-streams';

export const conversationRunStreams = new ConversationRunStreams({
  emit: (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        typedSend(window.webContents, 'conversation:run-event', event);
      } catch {
        // Conversation runs remain durable when a renderer is closing or absent.
      }
    }
  },
});
