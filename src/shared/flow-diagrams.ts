export type FlowDiagramExportFormat = 'png' | 'svg';

export interface FlowDiagramExportRequest {
  requestId: string;
  content: string;
  format: FlowDiagramExportFormat;
}

export type FlowDiagramExportResponse =
  | {
      requestId: string;
      ok: true;
      bytes: Uint8Array;
      mimeType: 'image/png' | 'image/svg+xml';
    }
  | {
      requestId: string;
      ok: false;
      error: string;
    };

export const FLOW_DIAGRAM_EXPORT_REQUEST_CHANNEL = 'flow-diagram:export-request';
export const FLOW_DIAGRAM_EXPORT_RESPONSE_CHANNEL = 'flow-diagram:export-response';
