import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { TaskPanel } from './components/TaskPanel/TaskPanel';
import { useThemeStore } from './stores/themeStore';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
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
    <div className="flex h-screen bg-[var(--color-bg-app)]">
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onResize={(w) => setSidebarWidth(w)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatArea />
      </main>
      <TaskPanel />
    </div>
  );
}
