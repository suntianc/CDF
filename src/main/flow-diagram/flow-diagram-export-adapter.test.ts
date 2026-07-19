import { describe, expect, it, vi } from 'vitest';
import type { ExcalidrawScene } from './flow-diagram-scene';

const { listeners, send, windows } = vi.hoisted(() => ({
  listeners: new Map<string, (event: any, response: any) => void>(),
  send: vi.fn(),
  windows: [] as any[],
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => windows) },
  ipcMain: {
    on: vi.fn((channel: string, listener: (event: any, response: any) => void) => {
      listeners.set(channel, listener);
    }),
  },
}));

import {
  renderFlowDiagramExportAdapter,
  registerFlowDiagramExportResponseHandler,
} from './flow-diagram-export-adapter';
import {
  FLOW_DIAGRAM_EXPORT_REQUEST_CHANNEL,
  FLOW_DIAGRAM_EXPORT_RESPONSE_CHANNEL,
} from '../../shared/flow-diagrams';

const scene: ExcalidrawScene = {
  type: 'excalidraw',
  version: 2,
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
};

describe('Flow Diagram official export adapter', () => {
  it('round-trips export bytes through the official renderer bridge', async () => {
    windows.splice(0, windows.length, {
      isDestroyed: () => false,
      webContents: { id: 42, send },
    });
    registerFlowDiagramExportResponseHandler();

    const pending = renderFlowDiagramExportAdapter(scene, 'svg');
    const [channel, request] = send.mock.calls.at(-1)!;
    expect(channel).toBe(FLOW_DIAGRAM_EXPORT_REQUEST_CHANNEL);
    expect(request.content).toContain('"type": "excalidraw"');

    listeners.get(FLOW_DIAGRAM_EXPORT_RESPONSE_CHANNEL)?.(
      { sender: { id: 42 } },
      {
        requestId: request.requestId,
        ok: true,
        bytes: new TextEncoder().encode('<svg/>'),
        mimeType: 'image/svg+xml',
      },
    );

    await expect(pending).resolves.toEqual({
      bytes: Buffer.from('<svg/>'),
      mimeType: 'image/svg+xml',
    });
  });
});
