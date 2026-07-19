import { Copy, ExternalLink, FilePlus, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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

export function FileTreeContextMenu({ x, y, isDirectory, onAction, onClose }: FileTreeContextMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span style={{ position: 'fixed', left: x, top: y, width: 0, height: 0, pointerEvents: 'none' }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[180px] text-xs font-normal bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1 z-[9999]">
        {isDirectory && (
          <>
            <DropdownMenuItem onClick={() => { onAction({ type: 'newFile' }); onClose(); }} className="text-xs">
              <FilePlus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              {t('filePanel.newFile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { onAction({ type: 'newFolder' }); onClose(); }} className="text-xs">
              <FolderPlus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              {t('filePanel.newFolder')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => { onAction({ type: 'rename' }); onClose(); }} className="text-xs">
          <Pencil className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          {t('filePanel.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { onAction({ type: 'delete' }); onClose(); }} className="text-xs text-[var(--color-danger)] focus:bg-[var(--color-danger-dim)] focus:text-[var(--color-danger)]">
          <Trash2 className="w-3.5 h-3.5 text-[var(--color-danger)]" />
          {t('filePanel.delete')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => { onAction({ type: 'copyPath' }); onClose(); }} className="text-xs">
          <Copy className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          {t('filePanel.copyPath')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { onAction({ type: 'revealInFinder' }); onClose(); }} className="text-xs">
          <ExternalLink className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          {t('filePanel.revealInFinder')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
