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
  FLOW_DIAGRAM_SOURCE_CHANGED,
  type FlowDiagramDocumentSnapshot,
  type FlowDiagramDocumentVersion,
} from '@shared/flow-diagrams';
import {
  restoreFlowDiagram,
  serializeFlowDiagram,
  type FlowDiagramAppState,
  type FlowDiagramElements,
  type FlowDiagramFiles,
  type RestoredFlowDiagram,
} from './excalidrawAdapter';

const AUTOSAVE_DELAY_MS = 750;
let mutationSequence = 0;

interface FlowDiagramEditorProps {
  content: string;
  documentVersion?: FlowDiagramDocumentVersion;
  fileName: string;
  filePath: string;
  loadError?: 'unreadable';
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; diagram: RestoredFlowDiagram }
  | { status: 'invalid'; reason: 'invalid' | 'unreadable' };

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

function nextMutationId(): string {
  mutationSequence += 1;
  return `flow-diagram-${Date.now()}-${mutationSequence}`;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function FlowDiagramEditor({
  content,
  documentVersion,
  fileName,
  filePath,
  loadError,
}: FlowDiagramEditorProps) {
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineContentRef = useRef<string | null>(null);
  const documentVersionRef = useRef<FlowDiagramDocumentVersion | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const saveOperationRef = useRef<Promise<boolean> | null>(null);
  const savingContentRef = useRef<string | null>(null);
  const activeMutationIdRef = useRef<string | null>(null);
  const latestNotifiedVersionRef = useRef<FlowDiagramDocumentVersion | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const installAuthoritativeSnapshot = useCallback(async (
    snapshot: FlowDiagramDocumentSnapshot,
    preservedLocalContent: string | null,
    notificationGuard?: FlowDiagramDocumentVersion | null,
  ): Promise<boolean> => {
    try {
      const diagram = await restoreFlowDiagram(snapshot.content);
      if (
        notificationGuard !== undefined
        && latestNotifiedVersionRef.current !== notificationGuard
      ) {
        return true;
      }
      const restoredContent = serializeFlowDiagram(
        diagram.elements,
        diagram.appState,
        diagram.files,
      );
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingContentRef.current = null;
      baselineContentRef.current = restoredContent;
      documentVersionRef.current = snapshot.version;

      const hasConflict = Boolean(
        preservedLocalContent && preservedLocalContent !== restoredContent,
      );
      const nextConflict = hasConflict ? preservedLocalContent : null;
      conflictedContentRef.current = nextConflict;
      setConflictedContent(nextConflict);
      setTabContent(filePath, snapshot.content, snapshot.version);
      setTabDirty(filePath, hasConflict);
      setSaveState(hasConflict ? 'dirty' : 'saved');
      setDiagramRevision((current) => current + 1);
      setLoadState({ status: 'ready', diagram });
      return !hasConflict;
    } catch {
      if (
        notificationGuard !== undefined
        && latestNotifiedVersionRef.current !== notificationGuard
      ) {
        return true;
      }
      if (preservedLocalContent && !conflictedContentRef.current) {
        conflictedContentRef.current = preservedLocalContent;
        setConflictedContent(preservedLocalContent);
      }
      setTabDirty(filePath, conflictedContentRef.current !== null);
      setSaveState(conflictedContentRef.current ? 'dirty' : 'error');
      setLoadState({ status: 'invalid', reason: 'invalid' });
      return false;
    }
  }, [filePath, setTabContent, setTabDirty]);

  const persistPending = useCallback((): Promise<boolean> => {
    if (!rootPath) return Promise.resolve(false);
    if (saveOperationRef.current) return saveOperationRef.current;

    const operation = (async () => {
      while (pendingContentRef.current && !conflictedContentRef.current) {
        const contentToSave = pendingContentRef.current;
        const expectedVersion = documentVersionRef.current;
        if (!expectedVersion) {
          setSaveState('error');
          return false;
        }

        const mutationId = nextMutationId();
        savingContentRef.current = contentToSave;
        activeMutationIdRef.current = mutationId;
        setSaveState('saving');

        try {
          const result = await window.electronAPI.flowDiagram.saveDocument(
            rootPath,
            filePath,
            contentToSave,
            expectedVersion,
            mutationId,
          );
          if (!result.ok) {
            if (result.error.code === FLOW_DIAGRAM_SOURCE_CHANGED) {
              const preserved = pendingContentRef.current ?? contentToSave;
              pendingContentRef.current = null;
              if (result.error.currentContent != null && result.error.currentVersion) {
                await installAuthoritativeSnapshot(
                  {
                    content: result.error.currentContent,
                    version: result.error.currentVersion,
                  },
                  preserved,
                );
              } else {
                conflictedContentRef.current = preserved;
                setConflictedContent(preserved);
                setTabDirty(filePath, true);
                setSaveState('dirty');
              }
              return false;
            }
            console.error('[FlowDiagramEditor] Save failed:', result.error.message);
            setSaveState('error');
            return false;
          }

          documentVersionRef.current = result.document.version;
          baselineContentRef.current = contentToSave;
          setTabContent(
            filePath,
            result.document.content,
            result.document.version,
          );
          if (pendingContentRef.current === contentToSave) {
            pendingContentRef.current = null;
          }
          const isDirty = pendingContentRef.current !== null;
          setTabDirty(filePath, isDirty);
          setSaveState(isDirty ? 'dirty' : 'saved');
        } catch (error) {
          console.error('[FlowDiagramEditor] Save error:', error);
          setSaveState('error');
          return false;
        } finally {
          savingContentRef.current = null;
          activeMutationIdRef.current = null;
        }
      }
      return conflictedContentRef.current === null;
    })();

    saveOperationRef.current = operation;
    void operation.finally(() => {
      if (saveOperationRef.current === operation) saveOperationRef.current = null;
    });
    return operation;
  }, [filePath, installAuthoritativeSnapshot, rootPath, setTabContent, setTabDirty]);

  const scheduleSave = useCallback((serialized: string) => {
    pendingContentRef.current = serialized;
    setSaveState('dirty');
    setTabDirty(filePath, true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistPending();
    }, AUTOSAVE_DELAY_MS);
  }, [filePath, persistPending, setTabDirty]);

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (conflictedContentRef.current) return false;
    while (pendingContentRef.current || saveOperationRef.current) {
      if (!await persistPending()) return false;
    }
    return true;
  }, [persistPending]);

  const handleChange = useCallback((
    elements: FlowDiagramElements,
    appState: FlowDiagramAppState,
    files: FlowDiagramFiles,
  ) => {
    const serialized = serializeFlowDiagram(elements, appState, files);
    if (serialized === pendingContentRef.current) return;
    if (
      serialized === baselineContentRef.current
      && savingContentRef.current === null
    ) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingContentRef.current = null;
      setTabDirty(filePath, false);
      setSaveState('saved');
      return;
    }
    scheduleSave(serialized);
  }, [filePath, scheduleSave, setTabDirty]);

  useEffect(() => {
    let cancelled = false;
    if (loadError || !documentVersion) {
      setLoadState({ status: 'invalid', reason: 'unreadable' });
      return () => {
        cancelled = true;
      };
    }
    if (
      baselineContentRef.current !== null
      && documentVersionRef.current === documentVersion
    ) {
      return () => {
        cancelled = true;
      };
    }

    setLoadState({ status: 'loading' });
    restoreFlowDiagram(content)
      .then((diagram) => {
        if (cancelled) return;
        baselineContentRef.current = serializeFlowDiagram(
          diagram.elements,
          diagram.appState,
          diagram.files,
        );
        documentVersionRef.current = documentVersion;
        pendingContentRef.current = null;
        setTabDirty(filePath, false);
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
  }, [content, documentVersion, filePath, loadError, setTabDirty]);

  useEffect(() => {
    if (!rootPath) return;
    const unsubscribe = window.electronAPI.flowDiagram.onDocumentChange((event) => {
      if (normalizedPath(event.filePath) !== normalizedPath(filePath)) return;
      if (event.mutationId && event.mutationId === activeMutationIdRef.current) return;
      if (event.version && event.version === documentVersionRef.current) return;

      latestNotifiedVersionRef.current = event.version;
      const notificationVersion = event.version;
      void (async () => {
        const result = await window.electronAPI.flowDiagram.loadDocument(rootPath, filePath);
        if (latestNotifiedVersionRef.current !== notificationVersion) return;
        if (!result.ok) {
          const preserved = (
            conflictedContentRef.current
            ?? pendingContentRef.current
            ?? savingContentRef.current
          );
          if (preserved && !conflictedContentRef.current) {
            conflictedContentRef.current = preserved;
            setConflictedContent(preserved);
          }
          pendingContentRef.current = null;
          setTabDirty(filePath, conflictedContentRef.current !== null);
          setSaveState(conflictedContentRef.current ? 'dirty' : 'error');
          setLoadState({ status: 'invalid', reason: 'unreadable' });
          return;
        }
        if (result.document.version === documentVersionRef.current) return;

        const savingContent = savingContentRef.current;
        if (savingContent && result.document.content === savingContent) {
          documentVersionRef.current = result.document.version;
          baselineContentRef.current = savingContent;
          setTabContent(
            filePath,
            result.document.content,
            result.document.version,
          );
          return;
        }

        const preserved = (
          conflictedContentRef.current
          ?? pendingContentRef.current
          ?? savingContent
        );
        await installAuthoritativeSnapshot(
          result.document,
          preserved,
          notificationVersion,
        );
      })();
    });
    return unsubscribe;
  }, [filePath, installAuthoritativeSnapshot, rootPath, setTabContent, setTabDirty]);

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
    if (!result.ok || result.file.loadError || !result.file.documentVersion) {
      setLoadState({ status: 'invalid', reason: 'unreadable' });
      return;
    }
    await installAuthoritativeSnapshot(
      {
        content: result.file.content,
        version: result.file.documentVersion,
      },
      null,
    );
  }, [fileName, filePath, installAuthoritativeSnapshot, rootPath]);

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
