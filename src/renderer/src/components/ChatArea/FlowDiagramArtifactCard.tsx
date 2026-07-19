import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openProjectFile } from '../../lib/openProjectFile';
import { useFileStore } from '../../stores/fileStore';

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'missing' }
  | { status: 'invalid' };

interface FlowDiagramArtifactCardProps {
  href: string;
  label: string;
}

function localFilePath(href: string): string {
  const withoutProtocol = href
    .replace(/^cdf-file:\/\//i, '')
    .replace(/^file:\/\//i, '');
  try {
    return decodeURIComponent(withoutProtocol);
  } catch {
    return withoutProtocol;
  }
}

function canonicalProjectFilePath(rootPath: string, filePath: string): string {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const requested = filePath.replace(/\\/g, '/');
  if (requested === root || requested.startsWith(`${root}/`)) return requested;
  return `${root}/${requested.replace(/^\/+/, '')}`;
}

export function FlowDiagramArtifactCard({ href, label }: FlowDiagramArtifactCardProps) {
  const { t } = useTranslation();
  const rootPath = useFileStore((state) => state.rootPath);
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [openFailed, setOpenFailed] = useState(false);
  const loadVersionRef = useRef(0);
  const sourcePath = useMemo(() => (
    rootPath
      ? canonicalProjectFilePath(rootPath, localFilePath(href))
      : localFilePath(href)
  ), [href, rootPath]);

  const load = useCallback(async () => {
    const version = ++loadVersionRef.current;
    const commit = (next: PreviewState) => {
      if (loadVersionRef.current === version) setPreview(next);
    };
    if (!rootPath) {
      commit({ status: 'missing' });
      return;
    }
    commit({ status: 'loading' });
    try {
      const result = await window.electronAPI.fs.readFile(rootPath, sourcePath);
      if (!result.ok) {
        commit({ status: 'missing' });
        return;
      }
      if ('binary' in result.data) {
        commit({ status: 'invalid' });
        return;
      }
      const { renderFlowDiagramThumbnail } = await import('../FilePanel/excalidrawAdapter');
      const src = await renderFlowDiagramThumbnail(result.data.content);
      commit({ status: 'ready', src });
    } catch {
      commit({ status: 'invalid' });
    }
  }, [rootPath, sourcePath]);

  useEffect(() => {
    let active = true;
    const loadCurrent = async () => {
      if (!active) return;
      await load();
    };
    void loadCurrent();
    const unsubscribe = window.electronAPI.fs.onDirectoryChange((_event, data) => {
      const changedPath = data.path.replace(/\\/g, '/');
      if (changedPath === sourcePath.replace(/\\/g, '/')) void loadCurrent();
    });
    return () => {
      active = false;
      loadVersionRef.current += 1;
      unsubscribe();
    };
  }, [load, sourcePath]);

  const handleOpen = async () => {
    if (!rootPath) return;
    setOpenFailed(false);
    const result = await openProjectFile(rootPath, sourcePath);
    if (!result.ok) setOpenFailed(true);
  };

  const title = label.trim() || sourcePath.split(/[\\/]/).pop() || t('chat.flowDiagramArtifact');
  const errorMessage = preview.status === 'missing'
    ? t('chat.flowDiagramMissing')
    : t('chat.flowDiagramInvalid');

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      aria-label={`${t('chat.flowDiagramOpen')}: ${title}`}
      className="group my-3 flex w-full max-w-[480px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-left transition-[border-color,background-color] duration-150 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] active:bg-[var(--color-bg-hover)]/50"
    >
      <span className="flex min-h-44 w-full items-center justify-center bg-[var(--color-bg-sunken)] p-4">
        {preview.status === 'loading' && (
          <span className="h-28 w-full animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-bg-hover)]" aria-label={t('chat.flowDiagramLoading')}>
            <span className="sr-only">{t('chat.flowDiagramLoading')}</span>
          </span>
        )}
        {preview.status === 'ready' && (
          <img
            src={preview.src}
            alt={title}
            className="max-h-40 max-w-full object-contain"
          />
        )}
        {(preview.status === 'missing' || preview.status === 'invalid') && (
          <span className="flex flex-col items-center gap-2 px-4 py-6 text-center text-xs text-[var(--color-danger)]">
            <FileWarning className="h-5 w-5" aria-hidden="true" />
            {errorMessage}
          </span>
        )}
      </span>
      <span className="flex w-full items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]">
          <Workflow className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
            {title}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-text-muted)]">
            {sourcePath}
          </span>
          {openFailed && (
            <span className="mt-1 block text-[11px] text-[var(--color-danger)]">
              {t('chat.flowDiagramOpenFailed')}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
          {t('chat.flowDiagramOpen')}
        </span>
      </span>
    </button>
  );
}
