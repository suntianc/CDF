import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send } }],
  },
}));

import { notifyFileChange } from './file-watcher';

describe('file-watcher Flow Diagram notifications', () => {
  let directory: string;

  beforeEach(() => {
    vi.useFakeTimers();
    send.mockClear();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-flow-watcher-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('publishes the current opaque version for an external diagram change', async () => {
    const filePath = path.join(directory, 'diagram.excalidraw');
    fs.writeFileSync(filePath, '{"type":"excalidraw"}');

    notifyFileChange(filePath);
    await vi.advanceTimersByTimeAsync(200);

    expect(send).toHaveBeenCalledWith(
      'flow-diagram:document-change',
      {
        filePath,
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    );
  });
});
