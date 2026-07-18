import { loadFromBlob, MIME_TYPES, serializeAsJSON } from '@excalidraw/excalidraw';

export type RestoredFlowDiagram = Awaited<ReturnType<typeof loadFromBlob>>;
export type FlowDiagramElements = Parameters<typeof serializeAsJSON>[0];
export type FlowDiagramAppState = Parameters<typeof serializeAsJSON>[1];
export type FlowDiagramFiles = Parameters<typeof serializeAsJSON>[2];

export async function restoreFlowDiagram(content: string): Promise<RestoredFlowDiagram> {
  const blob = new Blob([content], { type: MIME_TYPES.excalidraw });
  return loadFromBlob(blob, null, null);
}

export function serializeFlowDiagram(
  elements: FlowDiagramElements,
  appState: FlowDiagramAppState,
  files: FlowDiagramFiles,
): string {
  return serializeAsJSON(elements, appState, files, 'local');
}
