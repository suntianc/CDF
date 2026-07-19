import { BrowserWindow } from 'electron';
import { ConversationRunStreams } from './conversation-run-streams';

export const conversationRunStreams = new ConversationRunStreams({
  emit: (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        window.webContents.send('conversation:run-event', event);
      } catch {
        // Conversation runs remain durable when a renderer is closing or absent.
      }
    }
  },
});
