import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Save, X } from 'lucide-react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { reloadProjectFile } from '../../lib/openProjectFile';
import { registerProjectFileFlush } from '../../lib/projectFileFlush';
import { useFileStore } from '../../stores/fileStore';
import {
  restoreFlowDiagram,
  serializeFlowDiagram,
  type FlowDiagramAppState,
  type FlowDiagramElements,
  type FlowDiagramFiles,
  type RestoredFlowDiagram,
} from './excalidrawAdapter';

const AUTOSAVE_DELAY_MS = 750;

interface FlowDiagramEditorProps {
  content: string;
  fileName: string;
  filePath: string;
  loadError?: 'unreadable';
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; diagram: RestoredFlowDiagram }
  | { status: 'invalid'; reason: 'invalid' | 'unreadable' };

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function FlowDiagramEditor({ content, fileName, filePath, loadError }: FlowDiagramEditorProps) {
  const { t, i18n } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const rootPath = useFileStore((state) => state.rootPath);
  const setTabDirty = useFileStore((state) => state.setTabDirty);
  const setTabContent = useFileStore((state) => state.setTabContent);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [diagramRevision, setDiagramRevision] = useState(0);
  const [conflictedContent, setConflictedContent] = useState<string | null>(null);
  const conflictedContentRef = useRef<string | null>(null);
  const editGenerationRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastDiskContentRef = useRef<string | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastQueuedContentRef = useRef<string | null>(null);
  const queuedDiskContentRef = useRef<string | null>(null);
  const externalReloadVersionRef = useRef(0);
  const externalPendingPreservationRef = useRef<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const persist = useCallback((contentToSave: string): Promise<boolean> => {
    if (!rootPath) return Promise.resolve(false);
    if (lastQueuedContentRef.current === contentToSave) {
      return saveQueueRef.current;
    }

    const expectedDiskContent = queuedDiskContentRef.current ?? lastDiskContentRef.current ?? undefined;
    lastQueuedContentRef.current = contentToSave;
    queuedDiskContentRef.current = contentToSave;
    const operation = saveQueueRef.current.then(async () => {
      setSaveState('saving');
      try {
        const result = await window.electronAPI.fs.writeFile(
          rootPath,
          filePath,
          contentToSave,
          expectedDiskContent,
        );
        if (!result.ok) {
          console.error('[FlowDiagramEditor] Save failed:', result.error.message);
          setSaveState('error');
          return false;
        }

        lastSavedContentRef.current = contentToSave;
        lastDiskContentRef.current = contentToSave;
        setTabContent(filePath, contentToSave);
        if (pendingContentRef.current === contentToSave) {
          pendingContentRef.current = null;
          const hasConflict = conflictedContentRef.current !== null;
          setTabDirty(filePath, hasConflict);
          setSaveState(hasConflict ? 'dirty' : 'saved');
        } else {
          setSaveState('dirty');
        }
        return true;
      } catch (error) {
        console.error('[FlowDiagramEditor] Save error:', error);
        setSaveState('error');
        return false;
      }
    });

    saveQueueRef.current = operation;
    void operation.finally(() => {
      if (lastQueuedContentRef.current === contentToSave) {
        lastQueuedContentRef.current = null;
        queuedDiskContentRef.current = null;
      }
    });
    return operation;
  }, [filePath, rootPath, setTabContent, setTabDirty]);

  const scheduleSave = useCallback((serialized: string) => {
    pendingContentRef.current = serialized;
    setSaveState('dirty');
    setTabDirty(filePath, true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persist(serialized);
    }, AUTOSAVE_DELAY_MS);
  }, [filePath, persist, setTabDirty]);

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (conflictedContentRef.current) return false;
    while (true) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingContentRef.current;
      const saved = await (pending ? persist(pending) : saveQueueRef.current);
      if (!saved) return false;
      if (!pendingContentRef.current) return true;
    }
  }, [persist]);

  const handleChange = useCallback((
    elements: FlowDiagramElements,
    appState: FlowDiagramAppState,
    files: FlowDiagramFiles,
  ) => {
    const serialized = serializeFlowDiagram(elements, appState, files);
    if (
      serialized === lastSavedContentRef.current
      || serialized === pendingContentRef.current
    ) {
      return;
    }
    editGenerationRef.current += 1;
    scheduleSave(serialized);
  }, [scheduleSave]);

  useEffect(() => {
    let cancelled = false;
    if (lastSavedContentRef.current !== null && lastDiskContentRef.current === content) {
      return () => {
        cancelled = true;
      };
    }
    lastSavedContentRef.current = null;
    lastDiskContentRef.current = content;
    pendingContentRef.current = null;

    if (loadError) {
      setLoadState({ status: 'invalid', reason: 'unreadable' });
      return () => {
        cancelled = true;
      };
    }

    setLoadState({ status: 'loading' });
    restoreFlowDiagram(content)
      .then((diagram) => {
        if (cancelled) return;
        lastSavedContentRef.current = serializeFlowDiagram(
          diagram.elements,
          diagram.appState,
          diagram.files,
        );
        setSaveState('saved');
        setDiagramRevision((current) => current + 1);
        setLoadState({ status: 'ready', diagram });
      })
      .catch(() => {
        if (!cancelled) setLoadState({ status: 'invalid', reason: 'invalid' });
      });

    return () => {
      cancelled = true;
    };
  }, [content, loadError]);

  useEffect(() => {
    if (!rootPath) return;
    const unsubscribe = window.electronAPI.fs.onDirectoryChange((_event, data) => {
      if (data.path.replace(/\\/g, '/') !== filePath.replace(/\\/g, '/')) return;
      const version = ++externalReloadVersionRef.current;
      const generationAtNotification = editGenerationRef.current;
      void (async () => {
        const pendingAtNotification = pendingContentRef.current;
        if (pendingAtNotification) {
          externalPendingPreservationRef.current ??= pendingAtNotification;
        }
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingContentRef.current = null;
        await saveQueueRef.current;
        const result = await window.electronAPI.fs.readFile(rootPath, filePath);
        if (externalReloadVersionRef.current !== version || !result.ok || 'binary' in result.data) return;
        try {
          const diagram = await restoreFlowDiagram(result.data.content);
          const restoredContent = serializeFlowDiagram(
            diagram.elements,
            diagram.appState,
            diagram.files,
          );
          const pendingAfterWait = pendingContentRef.current;
          const editedWhileWaiting = editGenerationRef.current !== generationAtNotification;
          if (restoredContent === lastSavedContentRef.current) {
            const preserved = pendingAfterWait ?? externalPendingPreservationRef.current;
            externalPendingPreservationRef.current = null;
            if (preserved && preserved !== restoredContent) scheduleSave(preserved);
            return;
          }

          const preservedContent = editedWhileWaiting
            ? (pendingAfterWait ?? externalPendingPreservationRef.current)
            : (pendingAtNotification ?? externalPendingPreservationRef.current);
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          pendingContentRef.current = null;
          externalPendingPreservationRef.current = null;
          if (preservedContent && preservedContent !== restoredContent && !conflictedContentRef.current) {
            conflictedContentRef.current = preservedContent;
            setConflictedContent(preservedContent);
          }

          setLoadState({ status: 'loading' });
          lastSavedContentRef.current = restoredContent;
          lastDiskContentRef.current = result.data.content;
          setSaveState(conflictedContentRef.current ? 'dirty' : 'saved');
          setTabDirty(filePath, conflictedContentRef.current !== null);
          setTabContent(filePath, result.data.content);
          setDiagramRevision((current) => current + 1);
          setLoadState({ status: 'ready', diagram });
        } catch {
          setLoadState({ status: 'invalid', reason: 'invalid' });
        }
      })();
    });
    return () => {
      externalReloadVersionRef.current += 1;
      unsubscribe();
    };
  }, [filePath, rootPath, scheduleSave, setTabContent, setTabDirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushPendingSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flushPendingSave]);

  useEffect(() => {
    return registerProjectFileFlush(filePath, flushPendingSave);
  }, [filePath, flushPendingSave]);

  useEffect(() => {
    return () => {
      void flushPendingSave();
    };
  }, [flushPendingSave]);

  const restoreConflictedContent = useCallback(async () => {
    if (!conflictedContent) return;
    setLoadState({ status: 'loading' });
    try {
      const diagram = await restoreFlowDiagram(conflictedContent);
      conflictedContentRef.current = null;
      setConflictedContent(null);
      setDiagramRevision((current) => current + 1);
      setLoadState({ status: 'ready', diagram });
      scheduleSave(conflictedContent);
    } catch {
      setLoadState({ status: 'invalid', reason: 'invalid' });
    }
  }, [conflictedContent, scheduleSave]);

  const discardConflictedContent = useCallback(() => {
    conflictedContentRef.current = null;
    setConflictedContent(null);
    setTabDirty(filePath, false);
    setSaveState('saved');
  }, [filePath, setTabDirty]);

  const retryLoad = useCallback(async () => {
    if (!rootPath) return;
    setLoadState({ status: 'loading' });
    const result = await reloadProjectFile(rootPath, filePath, fileName);
    if (!result.ok || result.file.loadError) {
      setLoadState({ status: 'invalid', reason: 'unreadable' });
      return;
    }

    try {
      const diagram = await restoreFlowDiagram(result.file.content);
      lastSavedContentRef.current = serializeFlowDiagram(
        diagram.elements,
        diagram.appState,
        diagram.files,
      );
      lastDiskContentRef.current = result.file.content;
      setSaveState('saved');
      setDiagramRevision((current) => current + 1);
      setLoadState({ status: 'ready', diagram });
    } catch {
      setLoadState({ status: 'invalid', reason: 'invalid' });
    }
  }, [fileName, filePath, rootPath]);

  if (loadState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" role="status">
        <span className="text-[12px] text-[var(--color-text-muted)]">
          {t('filePanel.flowDiagram.loading', 'Loading diagram...')}
        </span>
      </div>
    );
  }

  if (loadState.status === 'invalid') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="max-w-[320px] text-center">
          <AlertCircle className="mx-auto mb-3 h-6 w-6 text-[var(--color-danger)]" aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
            {t('filePanel.flowDiagram.invalidTitle', 'Unable to open diagram')}
          </h2>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {t(
              loadState.reason === 'unreadable'
                ? 'filePanel.flowDiagram.unreadableDescription'
                : 'filePanel.flowDiagram.invalidDescription',
              {
                name: fileName,
                defaultValue: '{{name}} is not a readable Excalidraw document. The original file was not changed.',
              },
            )}
          </p>
          <button
            type="button"
            onClick={() => void retryLoad()}
            className="mt-4 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {t('filePanel.flowDiagram.retryLoad', 'Retry diagram')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full"
      role="application"
      aria-label={t('filePanel.flowDiagram.editorLabel', { name: fileName, defaultValue: 'Edit diagram {{name}}' })}
    >
      <Excalidraw
        key={diagramRevision}
        initialData={{ ...loadState.diagram, scrollToContent: true }}
        theme={resolvedTheme}
        name={fileName.replace(/\.excalidraw$/i, '')}
        langCode={i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'}
        onChange={handleChange}
        viewModeEnabled={conflictedContent !== null}
        renderTopRightUI={() => (
          <div className="flex items-center gap-2">
            <span className="sr-only" role="status" aria-live="polite">
              {t(`filePanel.flowDiagram.${saveState}`)}
            </span>
            {conflictedContent && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void restoreConflictedContent();
                      }}
                      className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warning)] bg-[var(--color-warning-dim)] px-3 text-[12px] font-medium text-[var(--color-warning)] transition-colors hover:bg-[var(--color-warning)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warning)] focus-visible:ring-offset-2"
                    >
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      {t('filePanel.flowDiagram.restoreUnsaved')}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t('filePanel.flowDiagram.externalChangeConflict')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        discardConflictedContent();
                      }}
                      aria-label={t('filePanel.flowDiagram.keepAgentVersion')}
                      className="relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 before:absolute before:-inset-1 before:content-['']"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t('filePanel.flowDiagram.keepAgentVersionDescription')}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void flushPendingSave();
                  }}
                  disabled={!pendingContentRef.current || saveState === 'saving'}
                  className={`relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border bg-[var(--color-bg-surface)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed before:absolute before:-inset-1 before:content-[''] ${
                    saveState === 'error'
                      ? 'border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-dim)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:text-[var(--color-text-disabled)]'
                  }`}
                  aria-label={saveState === 'error'
                    ? t('filePanel.flowDiagram.retrySave', 'Save failed. Retry diagram save')
                    : t('filePanel.flowDiagram.save', 'Save diagram')}
                >
                  {saveState === 'error'
                    ? <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    : <Save className="h-4 w-4" aria-hidden="true" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {saveState === 'error'
                  ? t('filePanel.flowDiagram.retrySave', 'Save failed. Retry diagram save')
                  : t('filePanel.flowDiagram.saveShortcut', 'Save diagram (Ctrl/Cmd+S)')}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}
