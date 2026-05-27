import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelLeft, Search, Settings, MessageSquare, Trash2, GitFork, ArrowLeft, Monitor, SquarePen, LayoutGrid, Clock, Bot, Wrench } from 'lucide-react';
import { ProjectTree } from '../ProjectTree/ProjectTree';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  activeView: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows';
  onCollapse: () => void;
  onResize: (width: number) => void;
  onChangeView: (view: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows') => void;
}

export function Sidebar({
  collapsed,
  width,
  activeView,
  onCollapse,
  onResize,
  onChangeView
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
      const newWidth = Math.min(500, Math.max(240, e.clientX));
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
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
    return undefined;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleNewChat = () => {
    selectSession(null);
    onChangeView('chat');
  };

  const isSettings = activeView !== 'chat';

  return (
    <aside
      ref={sidebarRef}
      className={`${styles.sidebar} ${isSettings ? styles.settingsMode : ''} ${isResizing ? styles.noTransition : ''} ${collapsed ? styles.collapsed : ''}`}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className={styles.sidebarTop}>
        {isSettings ? (
          <button onClick={() => onChangeView('chat')} className={styles.backBtn}>
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

            <button 
              onClick={() => onChangeView('agents')} 
              className={`${styles.sidebarMenuBtn} ${activeView === 'agents' ? styles.active : ''}`}
            >
              <Bot className="w-4 h-4" />
              <span>Agents 管理</span>
            </button>

            <button 
              onClick={() => onChangeView('plugins')} 
              className={`${styles.sidebarMenuBtn} ${activeView === 'plugins' ? styles.active : ''}`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>插件</span>
            </button>

            <button
              onClick={() => onChangeView('workflows')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'workflows' ? styles.active : ''}`}
            >
              <GitFork className="w-4 h-4" />
              <span>工作流</span>
            </button>
          </>
        )}
      </div>

      {!isSettings && !collapsed && (
        <button
          onClick={onCollapse}
          className={styles.sidebarCollapseBtn}
          title="折叠侧边栏"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}

      {!isSettings ? (
        <>
          {/* Unified scrollable container for projects and conversations */}
          <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-4">
            {/* Project tree contains nested projects and sessions */}
            <ProjectTree />
          </div>

          <div className={styles.bottomBar}>
            <ThemeToggle />
            <button onClick={() => onChangeView('settings')} title="模型配置">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <div className={styles.settingsMenu}>
          <div className={styles.settingsMenuHeader}>通用设置</div>
          <div 
            className={`${styles.settingsMenuItem} ${activeView === 'settings' ? styles.active : ''}`}
            onClick={() => onChangeView('settings')}
          >
            <Monitor className="w-4 h-4" />
            LLM 管理
          </div>
          <div 
            className={`${styles.settingsMenuItem} ${activeView === 'agents' ? styles.active : ''}`}
            onClick={() => onChangeView('agents')}
          >
            <Bot className="w-4 h-4" />
            Agents 管理
          </div>
          <div 
            className={`${styles.settingsMenuItem} ${activeView === 'plugins' ? styles.active : ''}`}
            onClick={() => onChangeView('plugins')}
          >
            <LayoutGrid className="w-4 h-4" />
            Skills & MCP 管理
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'tools' ? styles.active : ''}`}
            onClick={() => onChangeView('tools')}
          >
            <Wrench className="w-4 h-4" />
            工具配置
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'workflows' ? styles.active : ''}`}
            onClick={() => onChangeView('workflows')}
          >
            <GitFork className="w-4 h-4" />
            工作流
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
