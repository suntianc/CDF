export function isFlowDiagramFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.excalidraw');
}
