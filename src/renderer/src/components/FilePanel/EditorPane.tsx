import { Suspense, lazy, useMemo } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useFileStore } from '../../stores/fileStore';

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
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const monacoTheme = isDark ? 'vs-dark' : 'light';

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-bg-canvas)] border-r border-[var(--color-border)] text-[12px] text-[var(--color-text-primary)]">
          <span className="truncate max-w-[160px]">{fileName}</span>
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Breadcrumb — relative to project root */}
      <div className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] truncate shrink-0">
        {(() => {
          const root = useFileStore.getState().rootPath;
          if (root && filePath.startsWith(root)) {
            return filePath.slice(root.length).replace(/^\//, '');
          }
          return filePath;
        })()}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
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
            value={content}
            theme={monacoTheme}
            options={{
              readOnly: true,
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
      </div>
    </div>
  );
}
