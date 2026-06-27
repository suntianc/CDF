import { useEffect, useCallback, useRef, useState } from 'react';
import { X, FolderTree } from 'lucide-react';
import { useFileStore } from '../../stores/fileStore';
import { useProjectStore } from '../../stores/projectStore';
import { FileFilterBar } from './FileFilterBar';
import { FileTree } from './FileTree';
import { EditorPane } from './EditorPane';

const MIN_PANEL_WIDTH = 200;
const MIN_CHAT_WIDTH_PCT = 0.40;   // 主对话面板的最小占比 (40%)
const MIN_EDITOR_WIDTH = 420;      // 预览模式下的最小物理宽度 (220px 文件树 + 200px 编辑器)

export function FilePanel() {
  const {
    filePanelOpen,
    filePanelMode,
    filePanelWidth,
    rootPath,
    previewFile,
    fileTreeCollapsed,
    setFilePanelOpen,
    setFilePanelWidth,
    setRootPath,
    setDirContents,
    setDirError,
    setLoading,
  } = useFileStore();

  const { projects, currentProjectId } = useProjectStore();
  const resizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mainWidth, setMainWidth] = useState(window.innerWidth);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  // Monitor the width of the <main> container to adjust file panel dynamically
  useEffect(() => {
    const mainEl = panelRef.current?.closest('main');
    if (!mainEl) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMainWidth(entry.contentRect.width);
      }
    });

    observer.observe(mainEl);
    setMainWidth(mainEl.clientWidth);

    return () => observer.disconnect();
  }, [filePanelOpen]);

  // Dynamically shrink filePanelWidth when mainWidth shrinks to protect ChatArea minimum width
  useEffect(() => {
    if (!filePanelOpen) return;
    const { filePanelMode, previewFile, filePanelWidth: currentWidth } = useFileStore.getState();
    const isEditor = filePanelMode === 'editor' && previewFile;
    
    const maxW = Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT));
    
    if (currentWidth > maxW) {
      const currentMinW = isEditor
        ? Math.min(MIN_EDITOR_WIDTH, maxW)
        : Math.min(MIN_PANEL_WIDTH, maxW);
      const targetWidth = Math.max(currentMinW, maxW);
      if (targetWidth !== currentWidth) {
        setFilePanelWidth(targetWidth);
      }
    }
  }, [mainWidth, filePanelOpen, filePanelMode, previewFile, setFilePanelWidth]);

  useEffect(() => {
    if (!currentProject?.path) return;
    if (rootPath === currentProject.path) return;
    setRootPath(currentProject.path);
  }, [currentProject?.path, rootPath, setRootPath]);

  useEffect(() => {
    if (!filePanelOpen || !rootPath) return;
    let cancelled = false;

    async function loadRoot() {
      setLoading(rootPath!, true);
      try {
        const result = await window.electronAPI.fs.readDirectory(rootPath!, rootPath!);
        if (cancelled) return;
        if (result.ok) {
          setDirContents(rootPath!, result.data);
        } else {
          console.error('[FilePanel] readDirectory failed:', result.error);
          setDirError(rootPath!, result.error.message);
        }
      } catch (err: any) {
        console.error('[FilePanel] Failed to load root directory:', err);
        if (!cancelled) setDirError(rootPath!, err?.message || '无法读取目录');
      } finally {
        if (!cancelled) setLoading(rootPath!, false);
      }
    }

    loadRoot();
    return () => { cancelled = true; };
  }, [filePanelOpen, rootPath, setDirContents, setLoading]);

  useEffect(() => {
    if (!rootPath) return;
    const unsub = window.electronAPI.fs.onDirectoryChange((_event, data) => {
      const dirPath = data.path.substring(0, data.path.lastIndexOf('/'));
      const { expandedDirs, dirContents } = useFileStore.getState();
      if (dirPath === rootPath || expandedDirs[dirPath] || dirContents[dirPath]) {
        window.electronAPI.fs.readDirectory(rootPath, dirPath).then((result) => {
          if (result.ok) setDirContents(dirPath, result.data);
        });
      }
    });
    return unsub;
  }, [rootPath, setDirContents]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        useFileStore.getState().toggleFilePanel();
      }
      if (e.key === 'Escape' && filePanelOpen) {
        const { openTabs, activeTabIndex } = useFileStore.getState();
        if (openTabs.length > 0) {
          useFileStore.getState().closeTab(activeTabIndex);
        } else {
          setFilePanelOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filePanelOpen, setFilePanelOpen]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = filePanelWidth;
      const mainEl = resizeRef.current?.closest('main');
      const mainWidth = mainEl?.clientWidth ?? window.innerWidth;

      const onMove = (moveEvent: MouseEvent) => {
        const { filePanelMode, previewFile } = useFileStore.getState();
        const isEditor = filePanelMode === 'editor' && previewFile;
        
        const maxW = Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT));
        const currentMinW = isEditor
          ? Math.min(MIN_EDITOR_WIDTH, maxW)
          : Math.min(MIN_PANEL_WIDTH, maxW);
          
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.min(maxW, Math.max(currentMinW, startWidth + delta));
        setFilePanelWidth(newWidth);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [filePanelWidth, setFilePanelWidth]
  );

  if (!filePanelOpen) return null;

  const isEditorMode = filePanelMode === 'editor' && previewFile;
  const showFileTree = !(isEditorMode && fileTreeCollapsed);

  const currentMinW = isEditorMode
    ? Math.min(showFileTree ? MIN_EDITOR_WIDTH : MIN_PANEL_WIDTH, Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT)))
    : Math.min(MIN_PANEL_WIDTH, Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT)));

  return (
    <div
      ref={panelRef}
      className="h-full border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] flex overflow-hidden relative"
      style={{ width: filePanelWidth, minWidth: currentMinW }}
    >
      {/* Editor pane (left side in editor mode) */}
      {isEditorMode && (
        <EditorPane
          filePath={previewFile.path}
          fileName={previewFile.name}
          content={previewFile.content}
        />
      )}

      {/* File tree column — hidden when collapsed in editor mode */}
      {!(isEditorMode && fileTreeCollapsed) && (
        <div className={`flex flex-col ${isEditorMode ? 'w-[220px] shrink-0 border-l border-[var(--color-border)]' : 'flex-1'}`}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
              <FolderTree className="w-3.5 h-3.5" />
              <span className="truncate max-w-[140px]">
                {currentProject?.name || '文件'}
              </span>
            </div>
            <button
              onClick={() => setFilePanelOpen(false)}
              className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <FileFilterBar />
          <FileTree />
        </div>
      )}

      {/* Resize handle — visual 1px, hit area 8px */}
      <div
        ref={resizeRef}
        onMouseDown={handleResizeStart}
        className="absolute left-0 top-0 bottom-0 w-[1px] cursor-col-resize hover:bg-[var(--color-accent)] transition-colors before:absolute before:inset-y-0 before:-left-[3px] before:w-[8px] before:content-['']"
      />
    </div>
  );
}
