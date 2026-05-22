import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelLeft, Search, Settings, MessageSquare, Trash2, GitFork, ArrowLeft, Monitor, SquarePen, LayoutGrid, Clock } from 'lucide-react';
import { ProjectTree } from '../ProjectTree/ProjectTree';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  activeView: 'chat' | 'settings';
  onCollapse: () => void;
  onResize: (width: number) => void;
  onOpenSettings?: () => void;
  onExitSettings?: () => void;
}

export function Sidebar({
  collapsed,
  width,
  activeView,
  onCollapse,
  onResize,
  onOpenSettings,
  onExitSettings
}: SidebarProps) {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const { currentProjectId } = useProjectStore();
  const { 
    sessions, activeSessionId, fetchSessions, createSession, selectSession 
  } = useSessionStore();

  useEffect(() => {
    if (currentProjectId) {
      fetchSessions(currentProjectId);
    }
  }, [currentProjectId, fetchSessions]);

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
    return undefined;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleNewChat = () => {
    selectSession(null);
  };

  if (collapsed) {
    return null;
  }

  const isSettings = activeView === 'settings';

  return (
    <aside
      ref={sidebarRef}
      className={`${styles.sidebar} ${isSettings ? styles.settingsMode : ''}`}
      style={{ width }}
    >
      <div className={styles.sidebarTop}>
        {isSettings ? (
          <button onClick={onExitSettings} className={styles.backBtn}>
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
        ) : (
          <>
            <button onClick={handleNewChat} className={styles.sidebarMenuBtn}>
              <SquarePen className="w-4 h-4" />
              <span>新对话</span>
            </button>

            <div className={styles.sidebarMenuSearch}>
              <Search className="w-4 h-4" />
              <input type="text" placeholder="搜索" />
            </div>

            <button className={styles.sidebarMenuBtn}>
              <LayoutGrid className="w-4 h-4" />
              <span>插件</span>
            </button>

            <button className={styles.sidebarMenuBtn}>
              <GitFork className="w-4 h-4" />
              <span>工作流</span>
            </button>

            <button
              onClick={onCollapse}
              className={styles.sidebarCollapseBtn}
              title="折叠侧边栏"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {!isSettings ? (
        <>
          {/* Unified scrollable container for projects and conversations */}
          <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-4">
            {/* Project tree contains nested projects and sessions */}
            <ProjectTree />
          </div>

          <div className={styles.bottomBar}>
            <ThemeToggle />
            <button onClick={onOpenSettings} title="模型配置">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <div className={styles.settingsMenu}>
          <div className={styles.settingsMenuHeader}>通用设置</div>
          <div className={`${styles.settingsMenuItem} ${styles.active}`}>
            <Monitor className="w-4 h-4" />
            模型供应商配置
          </div>
        </div>
      )}

      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
