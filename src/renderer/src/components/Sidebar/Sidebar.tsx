import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeft, Settings, GitFork, ArrowLeft, Monitor, SquarePen, LayoutGrid, Bot, Wrench, Sliders } from 'lucide-react';
import { ProjectTree } from '../ProjectTree/ProjectTree';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  activeView: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows' | 'system';
  onCollapse: () => void;
  onResize: (width: number) => void;
  onChangeView: (view: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows' | 'system') => void;
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
  const { t } = useTranslation();

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

  const isSettings: boolean = activeView !== 'chat';

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
            {t('sidebar.back')}
          </button>
        ) : (
          <>
            <button onClick={handleNewChat} className={styles.sidebarMenuBtn}>
              <SquarePen className="w-4 h-4" />
              <span>{t('sidebar.newChat')}</span>
            </button>

            <button
              onClick={() => onChangeView('agents')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'agents' ? styles.active : ''}`}
            >
              <Bot className="w-4 h-4" />
              <span>{t('sidebar.agents')}</span>
            </button>

            <button
              onClick={() => onChangeView('plugins')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'plugins' ? styles.active : ''}`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>{t('sidebar.plugins')}</span>
            </button>

            <button
              onClick={() => onChangeView('workflows')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'workflows' ? styles.active : ''}`}
            >
              <GitFork className="w-4 h-4" />
              <span>{t('sidebar.workflows')}</span>
            </button>
          </>
        )}
      </div>

      {!isSettings && !collapsed && (
        <button
          onClick={onCollapse}
          className={styles.sidebarCollapseBtn}
          title={t('sidebar.collapse')}
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
            <button onClick={() => onChangeView('system')} title={t('sidebar.settings.system', '系统设置')}>
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <div className={styles.settingsMenu}>
          <div className={styles.settingsMenuHeader}>{t('sidebar.settings.header')}</div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'settings' ? styles.active : ''}`}
            onClick={() => onChangeView('settings')}
          >
            <Monitor className="w-4 h-4" />
            {t('sidebar.settings.llm')}
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'agents' ? styles.active : ''}`}
            onClick={() => onChangeView('agents')}
          >
            <Bot className="w-4 h-4" />
            {t('sidebar.settings.agents')}
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'plugins' ? styles.active : ''}`}
            onClick={() => onChangeView('plugins')}
          >
            <LayoutGrid className="w-4 h-4" />
            {t('sidebar.settings.skillsMcp')}
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'tools' ? styles.active : ''}`}
            onClick={() => onChangeView('tools')}
          >
            <Wrench className="w-4 h-4" />
            {t('sidebar.settings.tools')}
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'workflows' ? styles.active : ''}`}
            onClick={() => onChangeView('workflows')}
          >
            <GitFork className="w-4 h-4" />
            {t('sidebar.settings.workflows')}
          </div>
          <div
            className={`${styles.settingsMenuItem} ${activeView === 'system' ? styles.active : ''}`}
            onClick={() => onChangeView('system')}
          >
            <Sliders className="w-4 h-4" />
            {t('sidebar.settings.system', '系统设置')}
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
