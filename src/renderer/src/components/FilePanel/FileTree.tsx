import { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFileStore } from '../../stores/fileStore';
import { FileTreeItem } from './FileTreeItem';
import { FileTreeContextMenu, type ContextMenuAction } from './FileTreeContextMenu';
import { InlineInput } from './InlineInput';
import type { DirectoryEntry } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

async function loadDirectory(rootPath: string, dirPath: string) {
  const result = await window.electronAPI.fs.readDirectory(rootPath, dirPath);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

async function refreshDir(rootPath: string, dirPath: string) {
  const result = await window.electronAPI.fs.readDirectory(rootPath, dirPath);
  if (result.ok) useFileStore.getState().setDirContents(dirPath, result.data);
}

interface PendingInput {
  type: 'create-file' | 'create-dir' | 'rename';
  parentPath: string;
  entryPath?: string;
  entryName?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirectoryEntry;
}

function TreeNode({
  entry,
  depth,
  pendingInput,
  onContextMenu,
  onPendingSubmit,
  onPendingCancel,
}: {
  entry: DirectoryEntry;
  depth: number;
  pendingInput: PendingInput | null;
  onContextMenu: (e: React.MouseEvent, entry: DirectoryEntry) => void;
  onPendingSubmit: (value: string) => void;
  onPendingCancel: () => void;
}) {
  const {
    rootPath,
    expandedDirs,
    dirContents,
    loading,
    selectedPath,
    toggleDir,
    setDirContents,
    setDirError,
    setLoading,
    filterQuery,
  } = useFileStore();

  const isExpanded = expandedDirs[entry.path] ?? false;
  const isLoading = loading[entry.path] ?? false;
  const children = dirContents[entry.path];
  const isSelected = selectedPath === entry.path;

  const isRenaming = pendingInput?.type === 'rename' && pendingInput.entryPath === entry.path;

  const handleToggle = useCallback(
    async (dirPath: string) => {
      if (!rootPath) return;
      const wasExpanded = expandedDirs[dirPath];
      toggleDir(dirPath);

      if (!wasExpanded) {
        window.electronAPI.fs.watchDirectory(rootPath, dirPath);
        if (!dirContents[dirPath]) {
          setLoading(dirPath, true);
          try {
            const entries = await loadDirectory(rootPath, dirPath);
            setDirContents(dirPath, entries);
          } catch (err: any) {
            console.error('[FileTree] Failed to load directory:', err);
            setDirError(dirPath, err?.message || '加载失败');
          } finally {
            setLoading(dirPath, false);
          }
        }
      } else {
        window.electronAPI.fs.unwatchDirectory(dirPath);
      }
    },
    [rootPath, expandedDirs, dirContents, toggleDir, setDirContents, setDirError, setLoading]
  );

  const handleClick = useCallback(
    async (clickedEntry: DirectoryEntry) => {
      if (!rootPath) return;
      useFileStore.getState().setSelectedPath(clickedEntry.path);
      try {
        const result = await window.electronAPI.fs.readFile(rootPath, clickedEntry.path);
        if (!result.ok) {
          console.error('[FileTree] Failed to read file:', result.error.message);
          return;
        }
        if ('binary' in result.data) {
          return;
        }
        useFileStore.getState().openPreview({
          path: clickedEntry.path,
          name: clickedEntry.name,
          content: result.data.content,
        });
      } catch (err) {
        console.error('[FileTree] Error reading file:', err);
      }
    },
    [rootPath]
  );

  if (filterQuery && !entry.name.toLowerCase().includes(filterQuery.toLowerCase())) {
    if (!entry.isDirectory) return null;
  }

  const showPendingCreate = pendingInput &&
    (pendingInput.type === 'create-file' || pendingInput.type === 'create-dir') &&
    pendingInput.parentPath === entry.path;

  return (
    <>
      {isRenaming ? (
        <InlineInput
          depth={depth}
          icon={entry.isDirectory ? 'folder' : 'file'}
          defaultValue={entry.name}
          onSubmit={onPendingSubmit}
          onCancel={onPendingCancel}
        />
      ) : (
        <FileTreeItem
          entry={entry}
          depth={depth}
          isExpanded={isExpanded}
          isLoading={isLoading}
          isSelected={isSelected}
          onToggle={handleToggle}
          onClick={handleClick}
          onContextMenu={onContextMenu}
        />
      )}
      {entry.isDirectory && isExpanded && (
        <>
          {showPendingCreate && (
            <InlineInput
              depth={depth + 1}
              icon={pendingInput.type === 'create-dir' ? 'folder' : 'file'}
              onSubmit={onPendingSubmit}
              onCancel={onPendingCancel}
            />
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              pendingInput={pendingInput}
              onContextMenu={onContextMenu}
              onPendingSubmit={onPendingSubmit}
              onPendingCancel={onPendingCancel}
            />
          ))}
        </>
      )}
    </>
  );
}

export function FileTree() {
  const { t } = useTranslation();
  const { rootPath, dirContents, dirErrors, loading: loadingMap, expandedDirs, toggleDir, setDirContents } = useFileStore();
  const rootEntries = rootPath ? dirContents[rootPath] : undefined;
  const rootError = rootPath ? dirErrors[rootPath] : undefined;
  const isLoading = rootPath ? loadingMap[rootPath] : false;
  const containerRef = useRef<HTMLDivElement>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DirectoryEntry | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirectoryEntry) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleContextAction = useCallback(async (action: ContextMenuAction) => {
    if (!contextMenu || !rootPath) return;
    const { entry } = contextMenu;

    switch (action.type) {
      case 'copyPath':
        await navigator.clipboard.writeText(entry.path);
        break;
      case 'revealInFinder':
        await window.electronAPI.fs.showItemInFolder(entry.path);
        break;
      case 'newFile': {
        if (!expandedDirs[entry.path]) {
          toggleDir(entry.path);
          window.electronAPI.fs.watchDirectory(rootPath, entry.path);
        }
        setPendingInput({ type: 'create-file', parentPath: entry.path });
        break;
      }
      case 'newFolder': {
        if (!expandedDirs[entry.path]) {
          toggleDir(entry.path);
          window.electronAPI.fs.watchDirectory(rootPath, entry.path);
        }
        setPendingInput({ type: 'create-dir', parentPath: entry.path });
        break;
      }
      case 'rename':
        setPendingInput({ type: 'rename', parentPath: entry.path, entryPath: entry.path, entryName: entry.name });
        break;
      case 'delete':
        setDeleteConfirm(entry);
        break;
    }
  }, [contextMenu, rootPath, expandedDirs, toggleDir]);

  const handlePendingSubmit = useCallback(async (value: string) => {
    if (!pendingInput || !rootPath) return;
    const { type, parentPath, entryPath } = pendingInput;

    try {
      if (type === 'create-file') {
        const filePath = parentPath + '/' + value;
        const result = await window.electronAPI.fs.createFile(rootPath, filePath);
        if (!result.ok) throw new Error(result.error.message);
        await refreshDir(rootPath, parentPath);
      } else if (type === 'create-dir') {
        const dirPath = parentPath + '/' + value;
        const result = await window.electronAPI.fs.createDirectory(rootPath, dirPath);
        if (!result.ok) throw new Error(result.error.message);
        await refreshDir(rootPath, parentPath);
      } else if (type === 'rename' && entryPath) {
        const result = await window.electronAPI.fs.renameEntry(rootPath, entryPath, value);
        if (!result.ok) throw new Error(result.error.message);
        const parentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));
        await refreshDir(rootPath, parentDir || rootPath);
      }
    } catch (err: any) {
      console.error('[FileTree] Operation failed:', err);
      const errMsg = err?.message || '未知错误';
      if (type === 'create-file') {
        toast.error(t('filePanel.createFileFailed', { message: errMsg }));
      } else if (type === 'create-dir') {
        toast.error(t('filePanel.createFolderFailed', { message: errMsg }));
      } else if (type === 'rename') {
        toast.error(t('filePanel.renameFailed', { message: errMsg }));
      }
    }
    setPendingInput(null);
  }, [pendingInput, rootPath, t]);

  const handlePendingCancel = useCallback(() => {
    setPendingInput(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm || !rootPath) return;
    try {
      const result = await window.electronAPI.fs.trashEntry(rootPath, deleteConfirm.path);
      if (!result.ok) throw new Error(result.error.message);
      if (deleteConfirm.isDirectory) {
        window.electronAPI.fs.unwatchDirectory(deleteConfirm.path);
      }
      const parentDir = deleteConfirm.path.substring(0, deleteConfirm.path.lastIndexOf('/'));
      await refreshDir(rootPath, parentDir || rootPath);
    } catch (err: any) {
      console.error('[FileTree] Delete failed:', err);
      toast.error(t('filePanel.deleteFailed', { message: err?.message || '未知错误' }));
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, rootPath, t]);

  const handleRetry = useCallback(() => {
    if (!rootPath) return;
    const { setLoading, setDirContents, clearDirError } = useFileStore.getState();
    clearDirError(rootPath);
    setLoading(rootPath, true);
    window.electronAPI.fs.readDirectory(rootPath, rootPath)
      .then((result) => {
        if (result.ok) {
          setDirContents(rootPath, result.data);
        } else {
          useFileStore.getState().setDirError(rootPath, result.error.message);
        }
      })
      .catch((err: any) => {
        useFileStore.getState().setDirError(rootPath, err?.message || '无法读取目录');
      })
      .finally(() => {
        useFileStore.getState().setLoading(rootPath, false);
      });
  }, [rootPath]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = el.querySelectorAll<HTMLButtonElement>('[data-tree-item]');
      if (!items.length) return;

      const { selectedPath, setSelectedPath } = useFileStore.getState();
      const currentIdx = Array.from(items).findIndex(
        (item) => item.dataset.treePath === selectedPath
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, items.length - 1);
        const nextPath = items[next].dataset.treePath;
        if (nextPath) setSelectedPath(nextPath);
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        const prevPath = items[prev].dataset.treePath;
        if (prevPath) setSelectedPath(prevPath);
        items[prev].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowRight' && currentIdx >= 0) {
        const itemEl = items[currentIdx];
        const isDir = itemEl.getAttribute('data-is-directory') === 'true';
        const isExp = itemEl.getAttribute('data-is-expanded') === 'true';
        if (isDir && !isExp) {
          e.preventDefault();
          itemEl.click();
        }
      } else if (e.key === 'ArrowLeft' && currentIdx >= 0) {
        const itemEl = items[currentIdx];
        const isDir = itemEl.getAttribute('data-is-directory') === 'true';
        const isExp = itemEl.getAttribute('data-is-expanded') === 'true';
        if (isDir && isExp) {
          e.preventDefault();
          itemEl.click();
        } else {
          e.preventDefault();
          const currentPath = itemEl.getAttribute('data-tree-path');
          if (currentPath) {
            const lastSlash = currentPath.lastIndexOf('/');
            if (lastSlash > 0) {
              const parentPath = currentPath.substring(0, lastSlash);
              const parentItem = Array.from(items).find(
                (item) => item.dataset.treePath === parentPath
              );
              if (parentItem) {
                setSelectedPath(parentPath);
                parentItem.scrollIntoView({ block: 'nearest' });
              }
            }
          }
        }
      } else if (e.key === 'Enter' && currentIdx >= 0) {
        e.preventDefault();
        items[currentIdx].click();
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!rootPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] px-4 text-center">
        {t('filePanel.selectProject')}
      </div>
    );
  }

  if (isLoading && !rootEntries) {
    return (
      <div className="flex-1 px-2 py-2" role="status" aria-label={t('filePanel.loadingTree')}>
        <span className="sr-only">{t('filePanel.loadingTree')}</span>
        <div className="space-y-1" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="flex h-7 items-center gap-2 rounded-[var(--radius-sm)] px-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-[var(--radius-xs)] bg-[var(--color-bg-sunken)] animate-pulse" />
              <span
                className="h-3 rounded-[var(--radius-xs)] bg-[var(--color-bg-sunken)] animate-pulse"
                style={{ width: `${48 + (index % 3) * 16}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rootError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-4 text-center">
        <AlertCircle className="w-5 h-5 text-[var(--color-danger)]" />
        <span className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">{rootError}</span>
        <button
          onClick={handleRetry}
          className="flex min-h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--color-accent)] transition-[background-color,color] duration-150 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-accent-hover)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <RefreshCw className="w-3 h-3" />
          {t('filePanel.retry')}
        </button>
      </div>
    );
  }

  if (rootEntries && rootEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] px-4 text-center">
        {t('filePanel.emptyDirectory')}
      </div>
    );
  }

  if (!rootEntries) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-1 outline-none" tabIndex={0}>
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          pendingInput={pendingInput}
          onContextMenu={handleContextMenu}
          onPendingSubmit={handlePendingSubmit}
          onPendingCancel={handlePendingCancel}
        />
      ))}

      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirectory={contextMenu.entry.isDirectory}
          filePath={contextMenu.entry.path}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmDialog
          name={deleteConfirm.name}
          isDirectory={deleteConfirm.isDirectory}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

function DeleteConfirmDialog({ name, isDirectory, onConfirm, onCancel }: {
  name: string;
  isDirectory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onConfirm]);

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t('filePanel.deleteTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-[var(--color-text-primary)] mb-2 mt-1">
          {t('filePanel.deleteConfirm', { name, type: isDirectory ? t('filePanel.folder') : t('filePanel.file') })}
        </p>
        <DialogFooter className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-[12px] rounded bg-[var(--color-danger)] text-white hover:opacity-90 cursor-pointer transition-colors"
          >
            {t('filePanel.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
