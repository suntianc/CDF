import { useFileStore, type PreviewFile } from '../stores/fileStore';
import { isFlowDiagramFile } from './flowDiagramFile';
import { flushProjectFile } from './projectFileFlush';

export type OpenProjectFileResult =
  | { ok: true; file: PreviewFile; reused: boolean }
  | { ok: false; message: string };

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function canonicalProjectFilePath(rootPath: string, filePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (
    normalizedFile === normalizedRoot
    || normalizedFile.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedFile;
  }
  return `${normalizedRoot}/${normalizedFile.replace(/^\/+/, '')}`;
}

async function openProjectFileFromDisk(
  rootPath: string,
  requestedPath: string,
  fileName: string,
  reuseOpenTab: boolean,
): Promise<OpenProjectFileResult> {
  const filePath = canonicalProjectFilePath(rootPath, requestedPath);
  const store = useFileStore.getState();
  const activeFile = store.openTabs[store.activeTabIndex];
  if (activeFile && activeFile.path !== filePath && !await flushProjectFile(activeFile.path)) {
    return {
      ok: false,
      message: 'Resolve the current file conflict before switching files.',
    };
  }
  store.setSelectedPath(filePath);

  const existingIndex = store.openTabs.findIndex(
    (tab) => canonicalProjectFilePath(rootPath, tab.path) === filePath,
  );
  if (reuseOpenTab && existingIndex >= 0) {
    store.setActiveTab(existingIndex);
    return { ok: true, file: store.openTabs[existingIndex], reused: true };
  }

  const openUnreadableDiagram = (): OpenProjectFileResult => {
    const file = {
      path: filePath,
      name: fileName,
      content: '',
      loadError: 'unreadable' as const,
    };
    useFileStore.getState().openPreview(file);
    return { ok: true, file, reused: false };
  };
  const isFlowDiagram = isFlowDiagramFile(fileName);

  try {
    const result = await window.electronAPI.fs.readFile(rootPath, filePath);
    if (!result.ok) {
      return isFlowDiagram
        ? openUnreadableDiagram()
        : { ok: false, message: result.error.message };
    }
    if ('binary' in result.data) {
      return isFlowDiagram
        ? openUnreadableDiagram()
        : { ok: false, message: 'Binary files cannot be opened in the editor.' };
    }

    const file = {
      path: filePath,
      name: fileName,
      content: result.data.content,
    };
    useFileStore.getState().openPreview(file);
    return { ok: true, file, reused: false };
  } catch (error) {
    if (isFlowDiagram) return openUnreadableDiagram();
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function openProjectFile(
  rootPath: string,
  filePath: string,
  fileName = fileNameFromPath(filePath),
): Promise<OpenProjectFileResult> {
  useFileStore.getState().setFilePanelOpen(true);
  return openProjectFileFromDisk(rootPath, filePath, fileName, true);
}

export function reloadProjectFile(
  rootPath: string,
  filePath: string,
  fileName = fileNameFromPath(filePath),
): Promise<OpenProjectFileResult> {
  return openProjectFileFromDisk(rootPath, filePath, fileName, false);
}
