import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ContextMenuAction {
  type: 'newFile' | 'newFolder' | 'rename' | 'delete' | 'copyPath' | 'revealInFinder';
}

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  isDirectory: boolean;
  filePath: string;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export function FileTreeContextMenu({ x, y, isDirectory, filePath, onAction, onClose }: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(4, y - rect.height)}px`;
    }
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(4, x - rect.width)}px`;
    }
  }, [x, y]);

  const item = (label: string, icon: React.ReactNode, action: ContextMenuAction['type']) => (
    <button
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors text-left"
      onClick={() => { onAction({ type: action }); onClose(); }}
    >
      {icon}
      {label}
    </button>
  );

  const separator = <div className="my-1 h-px bg-[var(--color-border)]" />;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg"
      style={{ left: x, top: y }}
    >
      {isDirectory && (
        <>
          {item(t('filePanel.newFile'), <FilePlus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, 'newFile')}
          {item(t('filePanel.newFolder'), <FolderPlus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, 'newFolder')}
          {separator}
        </>
      )}
      {item(t('filePanel.rename'), <Pencil className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, 'rename')}
      {item(t('filePanel.delete'), <Trash2 className="w-3.5 h-3.5 text-[var(--color-danger)]" />, 'delete')}
      {separator}
      {item(t('filePanel.copyPath'), <Copy className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, 'copyPath')}
      {item(t('filePanel.revealInFinder'), <ExternalLink className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />, 'revealInFinder')}
    </div>,
    document.body
  );
}
