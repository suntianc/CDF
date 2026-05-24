import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { TaskPanel } from './components/TaskPanel/TaskPanel';
import { ModelSettings } from './components/Settings/ModelSettings';
import { AgentLibrary } from './components/AgentLibrary/AgentLibrary';
import { PluginsPanel } from './components/PluginsPanel/PluginsPanel';
import { useThemeStore } from './stores/themeStore';
import { useProjectStore } from './stores/projectStore';
import { useSessionStore } from './stores/sessionStore';
import { PanelLeft } from 'lucide-react';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [activeView, setActiveView] = useState<'chat' | 'settings' | 'agents' | 'plugins'>('chat');
  const { setTheme } = useThemeStore();
  const { taskPanelOpen, setTaskPanelOpen } = useProjectStore();
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const [taskPanelWidth, setTaskPanelWidth] = useState(340);

  useEffect(() => {
    // Initialize theme from persistent store
    const initTheme = async () => {
      try {
        const savedTheme = await window.electronAPI.store.get('theme');
        if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme as string)) {
          setTheme(savedTheme as 'light' | 'dark' | 'system');
        }
      } catch (err) {
        console.error('Failed to load theme:', err);
      }
    };
    initTheme();
  }, [setTheme]);

  useEffect(() => {
    if (pendingApproval) {
      setTaskPanelOpen(true);
    }
  }, [pendingApproval, setTaskPanelOpen]);

  return (
    <div className={`flex h-screen bg-[var(--bg-app)] relative ${sidebarCollapsed ? 'sidebar-is-collapsed' : 'sidebar-is-expanded'}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        activeView={activeView}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onResize={(w) => setSidebarWidth(w)}
        onChangeView={(view) => setActiveView(view)}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div key={activeView} className="flex-1 flex flex-col h-full overflow-hidden animate-fade-up">
          {activeView === 'settings' && <ModelSettings />}
          {activeView === 'agents' && <AgentLibrary />}
          {activeView === 'plugins' && <PluginsPanel />}
          {activeView === 'chat' && (
            <ChatArea 
              onOpenSettings={() => setActiveView('settings')}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(false)}
              taskPanelOpen={taskPanelOpen}
              onToggleTaskPanel={() => setTaskPanelOpen(!taskPanelOpen)}
            />
          )}
        </div>
      </main>

      <TaskPanel 
        isOpen={taskPanelOpen} 
        onClose={() => setTaskPanelOpen(false)} 
        width={taskPanelWidth}
        onResize={(w) => setTaskPanelWidth(w)}
      />

      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute top-[5px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-[9999] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag after:absolute after:inset-[-8px] after:content-['']"
          title="展开侧边栏"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
