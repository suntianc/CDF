import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { TaskPanel } from './components/TaskPanel/TaskPanel';
import { ModelSettings } from './components/Settings/ModelSettings';
import { useThemeStore } from './stores/themeStore';
import { PanelLeft } from 'lucide-react';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
  const { setTheme } = useThemeStore();
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
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

  return (
    <div className={`flex h-screen bg-[var(--bg-app)] relative ${sidebarCollapsed ? 'sidebar-is-collapsed' : 'sidebar-is-expanded'}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        activeView={activeView}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onResize={(w) => setSidebarWidth(w)}
        onOpenSettings={() => setActiveView('settings')}
        onExitSettings={() => setActiveView('chat')}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {activeView === 'settings' ? (
          <ModelSettings />
        ) : (
          <ChatArea 
            onOpenSettings={() => setActiveView('settings')}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(false)}
            taskPanelOpen={taskPanelOpen}
            onToggleTaskPanel={() => setTaskPanelOpen(!taskPanelOpen)}
          />
        )}
      </main>

      <TaskPanel 
        isOpen={taskPanelOpen} 
        onClose={() => setTaskPanelOpen(false)} 
        width={taskPanelWidth}
        onResize={(w) => setTaskPanelWidth(w)}
      />
    </div>
  );
}
