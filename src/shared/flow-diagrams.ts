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

declare const flowDiagramDocumentVersionBrand: unique symbol;

/**
 * 精确文档字节的 opaque identity。调用方只能比较相等性，不能推断顺序。
 */
export type FlowDiagramDocumentVersion = string & {
  readonly [flowDiagramDocumentVersionBrand]: 'FlowDiagramDocumentVersion';
};

export interface FlowDiagramDocumentSnapshot {
  content: string;
  version: FlowDiagramDocumentVersion;
}

export interface FlowDiagramDocumentChangeEvent {
  filePath: string;
  version: FlowDiagramDocumentVersion | null;
  /** Present only for the CDF renderer mutation that directly caused this publication. */
  mutationId?: string;
}

export type FlowDiagramDocumentReadResult =
  | { ok: true; document: FlowDiagramDocumentSnapshot }
  | { ok: false; error: { code: string; message: string } };

/** 文档在保存基线之后被外部改写时的冲突码（编辑器与文档存储共享）。 */
export const FLOW_DIAGRAM_SOURCE_CHANGED = 'SOURCE_CHANGED' as const;

/**
 * Flow Diagram 文档存储的保存结果。成功与 SOURCE_CHANGED 都附带权威版本，
 * 编辑器无需通过通用文件系统 API 二次读取或自行维护磁盘内容镜像。
 */
export type FlowDiagramDocumentSaveResult =
  | { ok: true; document: FlowDiagramDocumentSnapshot }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        currentContent?: string | null;
        currentVersion?: FlowDiagramDocumentVersion | null;
      };
    };
