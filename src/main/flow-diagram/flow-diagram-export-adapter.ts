import crypto from 'crypto';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import {
  FLOW_DIAGRAM_EXPORT_REQUEST_CHANNEL,
  FLOW_DIAGRAM_EXPORT_RESPONSE_CHANNEL,
  type FlowDiagramExportResponse,
} from '../../shared/flow-diagrams';
import type { ExcalidrawScene } from './flow-diagram-scene';
import { serializeFlowDiagramScene } from './flow-diagram-scene';
import {
  renderFlowDiagramExport,
  type FlowDiagramExportArtifact,
  type FlowDiagramExportFormat,
} from './flow-diagram-export-renderer';

interface PendingExport {
  senderId: number;
  resolve: (artifact: FlowDiagramExportArtifact) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingExports = new Map<string, PendingExport>();
let responseHandlerRegistered = false;

function handleExportResponse(event: IpcMainEvent, response: FlowDiagramExportResponse): void {
  if (!response || typeof response.requestId !== 'string') return;
  const pending = pendingExports.get(response.requestId);
  if (!pending || pending.senderId !== event.sender.id) return;
  pendingExports.delete(response.requestId);
  clearTimeout(pending.timeout);
  if (!response.ok) {
    pending.reject(new Error(response.error));
    return;
  }
  if (!(response.bytes instanceof Uint8Array)) {
    pending.reject(new Error('Flow Diagram renderer returned invalid bytes.'));
    return;
  }
  pending.resolve({ bytes: Buffer.from(response.bytes), mimeType: response.mimeType });
}

export function registerFlowDiagramExportResponseHandler(): void {
  if (responseHandlerRegistered || typeof ipcMain?.on !== 'function') return;
  responseHandlerRegistered = true;
  ipcMain.on(FLOW_DIAGRAM_EXPORT_RESPONSE_CHANNEL, handleExportResponse);
}

/**
 * Production export adapter. The official SDK runs in the sandboxed renderer;
 * headless tests fall back to the deterministic canvas adapter.
 */
export async function renderFlowDiagramExportAdapter(
  scene: ExcalidrawScene,
  format: FlowDiagramExportFormat,
): Promise<FlowDiagramExportArtifact> {
  const targetWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!targetWindow) return renderFlowDiagramExport(scene, format);
  registerFlowDiagramExportResponseHandler();

  const requestId = crypto.randomUUID();
  const artifact = new Promise<FlowDiagramExportArtifact>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingExports.delete(requestId);
      reject(new Error('Official Excalidraw export timed out.'));
    }, 30_000);
    pendingExports.set(requestId, {
      senderId: targetWindow.webContents.id,
      resolve,
      reject,
      timeout,
    });
  });
  targetWindow.webContents.send(FLOW_DIAGRAM_EXPORT_REQUEST_CHANNEL, {
    requestId,
    content: serializeFlowDiagramScene(scene).toString('utf8'),
    format,
  });
  return artifact;
}
