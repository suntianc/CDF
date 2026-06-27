import { Suspense, lazy, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { X, Eye, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../stores/themeStore';
import { useFileStore } from '../../stores/fileStore';
import { MarkdownRenderer } from '../ChatArea/MarkdownRenderer';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', xml: 'xml',
  yaml: 'yaml', yml: 'yaml',
  py: 'python', sh: 'shell',
  sql: 'sql', graphql: 'graphql',
  rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', h: 'cpp',
  toml: 'ini', env: 'ini',
};

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
}

interface EditorPaneProps {
  filePath: string;
  fileName: string;
  content: string;
  onClose: () => void;
}

export function EditorPane({ filePath, fileName, content, onClose }: EditorPaneProps) {
  const language = useMemo(() => detectLanguage(fileName), [fileName]);
  const isMd = language === 'markdown';
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const monacoTheme = isDark ? 'vs-dark' : 'light';
  const { t } = useTranslation();

  const [mdPreview, setMdPreview] = useState(isMd);
  const [editedContent, setEditedContent] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedContentRef = useRef(content);
  const editedRef = useRef(editedContent);
  const filePathRef = useRef(filePath);
  const rootPath = useFileStore((s) => s.rootPath);

  editedRef.current = editedContent;

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setEditedContent(content);
    savedContentRef.current = content;
    setIsDirty(false);
    setMdPreview(language === 'markdown');
    filePathRef.current = filePath;
  }, [filePath, content, language]);

  useEffect(() => {
    window.electronAPI.store.get('autoSave').then((v: unknown) => {
      if (typeof v === 'boolean') setAutoSave(v);
    });
  }, []);

  const performSave = useCallback(async (contentToSave: string) => {
    if (!rootPath) return;
    const currentPath = filePathRef.current;
    try {
      const result = await window.electronAPI.fs.writeFile(rootPath, currentPath, contentToSave);
      if (!result.ok) {
        console.error('[EditorPane] Save failed:', result.error.message);
        return;
      }
      savedContentRef.current = contentToSave;
      if (editedRef.current === contentToSave) {
        setIsDirty(false);
      }
    } catch (err: any) {
      console.error('[EditorPane] Save error:', err);
    }
  }, [rootPath]);

  const save = useCallback(() => {
    if (!isDirty) return;
    performSave(editedRef.current);
  }, [isDirty, performSave]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [save]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    const newContent = value ?? '';
    setEditedContent(newContent);
    editedRef.current = newContent;
    const dirty = newContent !== savedContentRef.current;
    setIsDirty(dirty);

    if (autoSave && dirty) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        performSave(editedRef.current);
      }, 1000);
    }
  }, [autoSave, performSave]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-bg-canvas)] border-r border-[var(--color-border)] text-[12px] text-[var(--color-text-primary)]">
          <span className="truncate max-w-[160px]">{fileName}</span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" title={t('filePanel.unsaved')} />
          )}
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Markdown preview/edit toggle */}
        {isMd && (
          <div className="ml-auto flex items-center pr-2">
            <button
              onClick={() => setMdPreview(!mdPreview)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded cursor-pointer transition-colors"
              title={mdPreview ? t('filePanel.editSource') : t('filePanel.preview')}
            >
              {mdPreview ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {mdPreview ? t('filePanel.editSource') : t('filePanel.preview')}
            </button>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] truncate shrink-0">
        {(() => {
          const root = useFileStore.getState().rootPath;
          if (root && filePath.startsWith(root)) {
            return filePath.slice(root.length).replace(/^\//, '');
          }
          return filePath;
        })()}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {isMd && mdPreview ? (
          <div className="h-full overflow-y-auto px-4 py-3">
            <MarkdownRenderer text={editedContent} />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center h-full">
                <span className="w-4 h-4 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              language={language}
              value={editedContent}
              theme={monacoTheme}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                padding: { top: 8 },
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
