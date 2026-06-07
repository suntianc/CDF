import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { TaskPanel } from './components/TaskPanel/TaskPanel';
import { ModelSettings } from './components/Settings/ModelSettings';
import { ToolSettings } from './components/Settings/ToolSettings';
import { SystemSettings } from './components/Settings/SystemSettings';
import { AgentLibrary } from './components/AgentLibrary/AgentLibrary';
import { PluginsPanel } from './components/PluginsPanel/PluginsPanel';
import { WorkflowList } from './components/WorkflowEditor/WorkflowList';
import { WorkflowEditor } from './components/WorkflowEditor/WorkflowEditor';
import { ContextModal } from './components/ContextModal/ContextModal';
import { useThemeStore } from './stores/themeStore';
import { useI18nStore } from './stores/i18nStore';
import { useProjectStore } from './stores/projectStore';
import { useSessionStore } from './stores/sessionStore';
import { useWorkflowStore } from './stores/workflowStore';
import { Workflow } from '../shared/types';
import { PanelLeft } from 'lucide-react';
import { Toaster } from 'sonner';

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const { activeView, setActiveView, taskPanelOpen, setTaskPanelOpen } = useProjectStore();
  const { setTheme } = useThemeStore();
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const [taskPanelWidth, setTaskPanelWidth] = useState(340);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const { setCurrentWorkflow } = useWorkflowStore();
  const isEditingWorkflow = activeView === 'workflows' && !!editingWorkflow;

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
    useI18nStore.getState().initFromStore();
  }, []);

  useEffect(() => {
    if (pendingApproval && activeView === 'chat') {
      setTaskPanelOpen(true);
    }
  }, [pendingApproval, activeView, setTaskPanelOpen]);

  return (
    <div className={`flex h-screen bg-[var(--bg-app)] relative ${(sidebarCollapsed || isEditingWorkflow) ? 'sidebar-is-collapsed' : 'sidebar-is-expanded'}`}>
      <Sidebar
        collapsed={sidebarCollapsed || isEditingWorkflow}
        width={sidebarWidth}
        activeView={activeView}
        onCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onResize={(w) => setSidebarWidth(w)}
        onChangeView={(view) => setActiveView(view)}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div 
          key={activeView === 'workflows' ? `${activeView}-${editingWorkflow ? 'editor' : 'list'}` : activeView} 
          className="flex-1 flex flex-col h-full overflow-hidden animate-fade-up"
        >
          {activeView === 'settings' && <ModelSettings />}
          {activeView === 'tools' && <ToolSettings />}
          {activeView === 'system' && <SystemSettings />}
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
          {activeView === 'workflows' && !editingWorkflow && (
            <WorkflowList
              onSelectWorkflow={(wf) => {
                setCurrentWorkflow(wf);
                setEditingWorkflow(wf);
              }}
              onCreateWorkflow={() => {
                setCurrentWorkflow(null);
                setEditingWorkflow({ id: '', name: '', project_id: '', graph_data: { nodes: [], edges: [] }, status: 'draft', created_at: 0, updated_at: 0 } as Workflow);
              }}
            />
          )}
          {activeView === 'workflows' && editingWorkflow && (
            <WorkflowEditor
              workflow={editingWorkflow}
              onBack={() => {
                setEditingWorkflow(null);
                setCurrentWorkflow(null);
              }}
            />
          )}
        </div>
      </main>

      <TaskPanel 
        isOpen={activeView === 'chat' && taskPanelOpen} 
        onClose={() => setTaskPanelOpen(false)} 
        width={taskPanelWidth}
        onResize={(w) => setTaskPanelWidth(w)}
      />

      {sidebarCollapsed && !isEditingWorkflow && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute top-[5px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-[9999] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag after:absolute after:inset-[-8px] after:content-['']"
          title="展开侧边栏"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}
      <Toaster richColors position="bottom-right" theme="dark" />
      <ContextModal />
    </div>
  );
}
