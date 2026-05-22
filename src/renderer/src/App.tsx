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
      {/* Drawer handle fixed - visible only when sidebar is collapsed */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="fixed top-[10px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-50 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag"
          title="展开侧边栏"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}

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
          <ChatArea onOpenSettings={() => setActiveView('settings')} />
        )}
      </main>

      <TaskPanel />
    </div>
  );
}
