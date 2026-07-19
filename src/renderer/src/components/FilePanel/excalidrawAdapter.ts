import { exportToSvg, loadFromBlob, MIME_TYPES, serializeAsJSON } from '@excalidraw/excalidraw';

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

export async function renderFlowDiagramThumbnail(content: string): Promise<string> {
  const restored = await restoreFlowDiagram(content);
  const svg = await exportToSvg({
    elements: restored.elements.filter((element) => !element.isDeleted),
    appState: {
      ...restored.appState,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: restored.files,
    exportPadding: 24,
    skipInliningFonts: true,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(svg),
  )}`;
}
