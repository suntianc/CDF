import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeft, Settings, GitFork, ArrowLeft, Monitor, SquarePen, LayoutGrid, Bot, Wrench, Sliders, Microscope, Sparkles } from 'lucide-react';
import { ProjectTree } from '../ProjectTree/ProjectTree';
import { type AppView, useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

interface SidebarProps {
  collapsed: boolean;
  width: number;
  activeView: AppView;
  onCollapse: () => void;
  onResize: (width: number) => void;
  onChangeView: (view: AppView) => void;
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

  const isSettings = ['settings', 'ai-subscriptions', 'tools', 'research', 'system'].includes(activeView);

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
              aria-current={activeView === 'agents' ? 'page' : undefined}
            >
              <Bot className="w-4 h-4" />
              <span>{t('sidebar.agents')}</span>
            </button>

            <button
              onClick={() => onChangeView('plugins')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'plugins' ? styles.active : ''}`}
              aria-current={activeView === 'plugins' ? 'page' : undefined}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>{t('sidebar.plugins')}</span>
            </button>

            <button
              onClick={() => onChangeView('workflows')}
              className={`${styles.sidebarMenuBtn} ${activeView === 'workflows' ? styles.active : ''}`}
              aria-current={activeView === 'workflows' ? 'page' : undefined}
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
          aria-label={t('sidebar.collapse')}
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
            <button onClick={() => onChangeView('system')} title={t('sidebar.settings.system')} aria-label={t('sidebar.settings.system')}>
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <nav className={styles.settingsMenu} aria-label={t('sidebar.navigation')}>
          <div className={styles.settingsMenuHeader}>{t('sidebar.settings.header')}</div>
          <button
            type="button"
            className={`${styles.settingsMenuItem} ${activeView === 'settings' ? styles.active : ''}`}
            onClick={() => onChangeView('settings')}
            aria-current={activeView === 'settings' ? 'page' : undefined}
          >
            <Monitor className="w-4 h-4" />
            {t('sidebar.settings.llm')}
          </button>
          <button
            type="button"
            className={`${styles.settingsMenuItem} ${activeView === 'ai-subscriptions' ? styles.active : ''}`}
            onClick={() => onChangeView('ai-subscriptions')}
            aria-current={activeView === 'ai-subscriptions' ? 'page' : undefined}
          >
            <Sparkles className="w-4 h-4" />
            {t('sidebar.settings.aiSubscriptions')}
          </button>
          <button
            type="button"
            className={`${styles.settingsMenuItem} ${activeView === 'tools' ? styles.active : ''}`}
            onClick={() => onChangeView('tools')}
            aria-current={activeView === 'tools' ? 'page' : undefined}
          >
            <Wrench className="w-4 h-4" />
            {t('sidebar.settings.tools')}
          </button>
          <button
            type="button"
            className={`${styles.settingsMenuItem} ${activeView === 'research' ? styles.active : ''}`}
            onClick={() => onChangeView('research')}
            aria-current={activeView === 'research' ? 'page' : undefined}
          >
            <Microscope className="w-4 h-4" />
            {t('sidebar.settings.research')}
          </button>
          <button
            type="button"
            className={`${styles.settingsMenuItem} ${activeView === 'system' ? styles.active : ''}`}
            onClick={() => onChangeView('system')}
            aria-current={activeView === 'system' ? 'page' : undefined}
          >
            <Sliders className="w-4 h-4" />
            {t('sidebar.settings.system')}
          </button>
        </nav>
      )}

      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
