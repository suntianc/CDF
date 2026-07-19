import { exportToBlob, exportToSvg, loadFromBlob, MIME_TYPES, serializeAsJSON } from '@excalidraw/excalidraw';
import type { FlowDiagramExportFormat } from '@shared/flow-diagrams';

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

async function exportableFlowDiagram(content: string) {
  const restored = await restoreFlowDiagram(content);
  return {
    elements: restored.elements.filter((element) => !element.isDeleted),
    appState: {
      ...restored.appState,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: restored.files,
  };
}

export async function renderFlowDiagramThumbnail(content: string): Promise<string> {
  const restored = await exportableFlowDiagram(content);
  const svg = await exportToSvg({
    ...restored,
    exportPadding: 24,
    skipInliningFonts: true,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(svg),
  )}`;
}

export async function renderFlowDiagramExportWithSdk(
  content: string,
  format: FlowDiagramExportFormat,
): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/svg+xml' }> {
  const restored = await exportableFlowDiagram(content);
  if (format === 'svg') {
    const svg = await exportToSvg({
      ...restored,
      exportPadding: 24,
      skipInliningFonts: true,
    });
    return {
      bytes: new TextEncoder().encode(new XMLSerializer().serializeToString(svg)),
      mimeType: 'image/svg+xml',
    };
  }
  const blob = await exportToBlob({
    ...restored,
    mimeType: 'image/png',
    exportPadding: 24,
  });
  if (!blob) throw new Error('Excalidraw returned no PNG export.');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: 'image/png',
  };
}
