import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelLeftClose, PanelLeft, Search, Plus, Settings } from 'lucide-react';
import { ProjectTree } from '@/components/ProjectTree/ProjectTree';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  onCollapse: () => void;
  onResize: (width: number) => void;
}

export function Sidebar({ collapsed, width, onCollapse, onResize }: SidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(500, Math.max(200, e.clientX));
      onResize(newWidth);
    },
    [isResizing, onResize]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  if (collapsed) {
    return (
      <div className={styles.collapsedHandle}>
        <button
          onClick={onCollapse}
          className="p-2 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      style={{ width }}
    >
      <button className={styles.newChatBtn}>
        <Plus className="w-4 h-4" />
        新建对话
      </button>

      <div className={styles.searchBar}>
        <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
        <input type="text" placeholder="搜索..." />
      </div>

      <div className={styles.actionRow}>
        <button>智能体</button>
        <button>工作流</button>
      </div>

      <div className={styles.projectTree}>
        <ProjectTree />
      </div>

      <div className={styles.bottomBar}>
        <ThemeToggle />
        <button>
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
