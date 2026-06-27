import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import type { DirectoryEntry } from '../../../shared/types';
import { FileTypeIcon } from './FileTypeIcon';

interface FileTreeItemProps {
  entry: DirectoryEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  onToggle: (path: string) => void;
  onClick: (entry: DirectoryEntry) => void;
  onContextMenu?: (e: React.MouseEvent, entry: DirectoryEntry) => void;
}

export function FileTreeItem({ entry, depth, isExpanded, isLoading, isSelected, onToggle, onClick, onContextMenu }: FileTreeItemProps) {
  const handleClick = () => {
    if (entry.isDirectory) {
      onToggle(entry.path);
    } else {
      onClick(entry);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu?.(e, entry);
  };

  return (
    <button
      data-tree-item
      data-tree-path={entry.path}
      data-is-directory={entry.isDirectory}
      data-is-expanded={isExpanded}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`w-full flex items-center gap-1 py-[3px] pr-2 text-left text-[12px] cursor-pointer transition-colors group
        ${isSelected
          ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
          : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
        }`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {entry.isDirectory ? (
        <>
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-muted)]">
            {isLoading ? (
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </span>
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-secondary)]">
            {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
          </span>
        </>
      ) : (
        <>
          <span className="w-4 h-4 shrink-0" />
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            <FileTypeIcon filename={entry.name} />
          </span>
        </>
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}
