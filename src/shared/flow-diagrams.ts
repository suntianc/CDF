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

/** 文档在保存基线之后被外部改写时的冲突码（编辑器与文档存储共享）。 */
export const FLOW_DIAGRAM_SOURCE_CHANGED = 'SOURCE_CHANGED' as const;

/**
 * Flow Diagram 文档存储的保存结果。SOURCE_CHANGED 冲突附带当前磁盘内容，
 * 编辑器用它重定位下一次保存的 CAS 基线，无需二次读取。
 */
export type FlowDiagramDocumentSaveResult =
  | { ok: true }
  | {
      ok: false;
      error: { code: string; message: string; currentContent?: string | null };
    };
