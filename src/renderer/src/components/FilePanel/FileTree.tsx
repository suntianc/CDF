import { useCallback, useRef, useEffect } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useFileStore } from '../../stores/fileStore';
import { FileTreeItem } from './FileTreeItem';
import type { DirectoryEntry } from '../../../shared/types';

async function loadDirectory(rootPath: string, dirPath: string) {
  const result = await window.electronAPI.fs.readDirectory(rootPath, dirPath);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function TreeNode({ entry, depth }: { entry: DirectoryEntry; depth: number }) {
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

  const handleToggle = useCallback(
    async (dirPath: string) => {
      if (!rootPath) return;
      const wasExpanded = expandedDirs[dirPath];
      toggleDir(dirPath);

      if (!wasExpanded && !dirContents[dirPath]) {
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
    },
    [rootPath, expandedDirs, dirContents, toggleDir, setDirContents, setDirError, setLoading]
  );

  const handleClick = useCallback(
    async (entry: DirectoryEntry) => {
      if (!rootPath) return;
      useFileStore.getState().setSelectedPath(entry.path);
      try {
        const result = await window.electronAPI.fs.readFile(rootPath, entry.path);
        if (!result.ok) {
          console.error('[FileTree] Failed to read file:', result.error.message);
          return;
        }
        if ('binary' in result.data && result.data.binary) {
          return;
        }
        useFileStore.getState().openPreview({
          path: entry.path,
          name: entry.name,
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

  return (
    <>
      <FileTreeItem
        entry={entry}
        depth={depth}
        isExpanded={isExpanded}
        isLoading={isLoading}
        isSelected={isSelected}
        onToggle={handleToggle}
        onClick={handleClick}
      />
      {entry.isDirectory && isExpanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

export function FileTree() {
  const { rootPath, dirContents, dirErrors, loading: loadingMap } = useFileStore();
  const rootEntries = rootPath ? dirContents[rootPath] : undefined;
  const rootError = rootPath ? dirErrors[rootPath] : undefined;
  const isLoading = rootPath ? loadingMap[rootPath] : false;
  const containerRef = useRef<HTMLDivElement>(null);

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
        选择一个项目以浏览文件
      </div>
    );
  }

  if (isLoading && !rootEntries) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <span className="w-4 h-4 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
        <span className="text-[11px] text-[var(--color-text-muted)]">加载文件树…</span>
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
          className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] cursor-pointer transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          重试
        </button>
      </div>
    );
  }

  if (rootEntries && rootEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] px-4 text-center">
        空目录
      </div>
    );
  }

  if (!rootEntries) {
    return null;
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-1 outline-none" tabIndex={0}>
      {rootEntries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}
