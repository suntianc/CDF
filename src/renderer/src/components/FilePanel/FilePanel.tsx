import { useEffect, useCallback, useRef, useState } from 'react';
import { X, FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../../stores/fileStore';
import { useProjectStore } from '../../stores/projectStore';
import { FileFilterBar } from './FileFilterBar';
import { FileTree } from './FileTree';
import { EditorPane } from './EditorPane';
import { FileTypeIcon } from './FileTypeIcon';

const MIN_PANEL_WIDTH = 200;
const MIN_CHAT_WIDTH_PCT = 0.40;   // 主对话面板的最小占比 (40%)
const MIN_EDITOR_WIDTH = 420;      // 预览模式下的最小物理宽度 (220px 文件树 + 200px 编辑器)

export function FilePanel() {
  const { t } = useTranslation();
  const {
    filePanelOpen,
    filePanelMode,
    filePanelWidth,
    rootPath,
    previewFile,
    fileTreeCollapsed,
    openTabs,
    activeTabIndex,
    dirtyTabs,
    setFilePanelOpen,
    setFilePanelWidth,
    setRootPath,
    setDirContents,
    setDirError,
    setLoading,
    closeTab,
    setActiveTab,
  } = useFileStore();

  const { projects, currentProjectId } = useProjectStore();
  const resizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mainWidth, setMainWidth] = useState(window.innerWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--file-panel-width',
      `${filePanelOpen ? filePanelWidth : 0}px`
    );
  }, [filePanelOpen, filePanelWidth]);

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
    const cached = useFileStore.getState().dirContents[rootPath];
    if (cached) return;
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
      setIsResizing(true);
      document.documentElement.classList.add('file-panel-resizing');
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
        setIsResizing(false);
        document.documentElement.classList.remove('file-panel-resizing');
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [filePanelWidth, setFilePanelWidth]
  );

  const isEditorMode = filePanelMode === 'editor' && previewFile;
  const showFileTree = !(isEditorMode && fileTreeCollapsed);

  const currentMinW = isEditorMode
    ? Math.min(showFileTree ? MIN_EDITOR_WIDTH : MIN_PANEL_WIDTH, Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT)))
    : Math.min(MIN_PANEL_WIDTH, Math.max(0, mainWidth * (1 - MIN_CHAT_WIDTH_PCT)));

  const currentWidth = filePanelOpen ? filePanelWidth : 0;
  const minW = filePanelOpen ? currentMinW : 0;

  return (
    <div
      ref={panelRef}
      className={`h-full bg-[var(--color-bg-surface)] flex flex-col overflow-hidden relative ${
        isResizing ? 'transition-none' : 'transition-[width,min-width,opacity,border-color] duration-300 ease-in-out'
      } ${
        filePanelOpen
          ? 'border-l border-[var(--color-border)] opacity-100'
          : 'border-l-0 opacity-0 pointer-events-none'
      }`}
      style={{ width: currentWidth, minWidth: minW }}
    >
      {/* Shared Tab Bar (only visible when in editor mode and there are open tabs) */}
      {isEditorMode && openTabs.length > 0 && (
        <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] shrink-0 h-9 relative">
          {/* Left: Tabs */}
          <div className="mr-20 flex min-w-0 flex-1 items-center gap-0 overflow-x-auto scrollbar-none h-full">
            {openTabs.map((tab, i) => {
              const isActive = i === activeTabIndex;
              const isDirty = dirtyTabs[tab.path] ?? false;
              return (
                <div
                  key={tab.path}
                  className={`flex min-w-0 max-w-[160px] items-center gap-1.5 px-3 h-full border-r border-[var(--color-border)] text-[12px] cursor-pointer shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)] font-medium border-t-2 border-t-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                  onClick={() => setActiveTab(i)}
                >
                  <FileTypeIcon filename={tab.name} className="w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0 max-w-[100px] flex-1 truncate">{tab.name}</span>
                  {isDirty && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" title={t('filePanel.unsaved')} />
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(i); }}
                    className="shrink-0 p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area: Editor + File Tree */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {isEditorMode ? (
          <>
            <EditorPane
              filePath={previewFile.path}
              fileName={previewFile.name}
              content={previewFile.content}
            />
            <div
              className={`absolute top-8 right-0 bottom-0 w-[240px] z-10 border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] flex flex-col shadow-[0_8px_24px_rgba(30,20,10,0.10)] transition-[transform,opacity] duration-200 ease-out ${
                showFileTree
                  ? 'translate-x-0 opacity-100 pointer-events-auto'
                  : 'translate-x-full opacity-0 pointer-events-none'
              }`}
            >
              <FileFilterBar />
              <FileTree />
            </div>
          </>
        ) : (
          <div className="flex flex-col flex-1">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
                <FolderTree className="w-3.5 h-3.5" />
                <span className="truncate max-w-[140px]">
                  {currentProject?.name || '文件'}
                </span>
              </div>
            </div>
            <FileFilterBar />
            <FileTree />
          </div>
        )}
      </div>

      {/* Resize handle — visual 1px, hit area 8px */}
      {filePanelOpen && (
        <div
          ref={resizeRef}
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 bottom-0 w-[1px] cursor-col-resize transition-colors hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none before:absolute before:inset-y-0 before:-left-[3px] before:w-[8px] before:content-['']"
        />
      )}
    </div>
  );
}
