import type {
  FlowDiagramExportRequest,
  FlowDiagramExportResponse,
} from '@shared/flow-diagrams';

export function installFlowDiagramExportBridge(): () => void {
  return window.electronAPI.flowDiagram.onExportRequest((request: FlowDiagramExportRequest) => {
    void (async () => {
      let response: FlowDiagramExportResponse;
      try {
        const { renderFlowDiagramExportWithSdk } = await import(
          '../components/FilePanel/excalidrawAdapter'
        );
        const rendered = await renderFlowDiagramExportWithSdk(request.content, request.format);
        response = { requestId: request.requestId, ok: true, ...rendered };
      } catch {
        response = {
          requestId: request.requestId,
          ok: false,
          error: 'The official Excalidraw renderer could not export this document.',
        };
      }
      window.electronAPI.flowDiagram.resolveExport(response);
    })();
  });
}
