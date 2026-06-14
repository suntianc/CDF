import { Component, Suspense, lazy, useMemo, useState, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { ModelSettings } from './components/Settings/ModelSettings';
import { ToolSettings } from './components/Settings/ToolSettings';
import { SystemSettings } from './components/Settings/SystemSettings';
import { AgentLibrary } from './components/AgentLibrary/AgentLibrary';
import { PluginsPanel } from './components/PluginsPanel/PluginsPanel';
import { WorkflowList } from './components/WorkflowEditor/WorkflowList';
import { WorkflowEditor } from './components/WorkflowEditor/WorkflowEditor';
import { ContextModal } from './components/ContextModal/ContextModal';
import { useTheme } from './hooks/useTheme';
import { useI18nStore } from './stores/i18nStore';
import { useProjectStore } from './stores/projectStore';
import { useSessionStore } from './stores/sessionStore';
import { useWorkflowStore } from './stores/workflowStore';
import { Workflow } from '../shared/types';
import { PanelLeft } from 'lucide-react';
import { Toaster } from 'sonner';
import type { TaskPanelProps } from './components/TaskPanel/TaskPanel';

const loadTaskPanel = () => import('./components/TaskPanel/TaskPanel').then((mod) => ({ default: mod.TaskPanel }));

function TaskPanelFallback({ isOpen, width }: Pick<TaskPanelProps, 'isOpen' | 'width'>) {
  const { t } = useTranslation();
  return (
    <aside
      className={`h-full bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)] shrink-0 transition-all duration-300 ease-in-out ${
        isOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'
      }`}
      style={{ width: isOpen ? width : 0 }}
    >
      <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">
        {t('taskPanel.loading')}
      </div>
    </aside>
  );
}

class TaskPanelErrorBoundary extends Component<
  { children: ReactNode; isOpen: boolean; width: number; message: string; onRetry: () => void },
  { hasError: boolean; wasOpen: boolean }
> {
  constructor(props: { children: ReactNode; isOpen: boolean; width: number; message: string; onRetry: () => void }) {
    super(props);
    this.state = { hasError: false, wasOpen: props.isOpen };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { isOpen: boolean }) {
    if (this.state.hasError && this.props.isOpen && !prevProps.isOpen) {
      this.props.onRetry();
      this.setState({ hasError: false, wasOpen: true });
      return;
    }
    if (this.state.wasOpen !== this.props.isOpen) {
      this.setState({ wasOpen: this.props.isOpen });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[TaskPanelErrorBoundary] Task panel render failed:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <aside
        className={`h-full bg-[var(--color-bg-sidebar)] border-l border-[var(--color-danger)]/30 shrink-0 transition-all duration-300 ease-in-out ${
          this.props.isOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'
        }`}
        style={{ width: this.props.isOpen ? this.props.width : 0 }}
      >
        <div className="h-full flex items-center justify-center px-4 text-xs text-[var(--color-danger)] text-center">
          {this.props.message}
        </div>
      </aside>
    );
  }
}

export default function App() {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const { activeView, setActiveView, taskPanelOpen, setTaskPanelOpen } = useProjectStore();
  const { setTheme } = useTheme();
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const [taskPanelWidth, setTaskPanelWidth] = useState(340);
  const [taskPanelMounted, setTaskPanelMounted] = useState(false);
  const [taskPanelRetryKey, setTaskPanelRetryKey] = useState(0);
  const TaskPanel = useMemo(() => lazy(loadTaskPanel), [taskPanelRetryKey]);
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

  useEffect(() => {
    if (activeView === 'chat' && taskPanelOpen) {
      setTaskPanelMounted(true);
    }
  }, [activeView, taskPanelOpen]);

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
              onOpenTaskPanel={() => setTaskPanelOpen(true)}
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

      {sidebarCollapsed && !isEditingWorkflow && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute top-[5px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-[9999] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag after:absolute after:inset-[-8px] after:content-['']"
          title={t('app.expandSidebar')}
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}
      <Toaster richColors position="bottom-right" theme="dark" />
      <ContextModal />

      {taskPanelMounted && (
        <TaskPanelErrorBoundary
          isOpen={activeView === 'chat' && taskPanelOpen}
          width={taskPanelWidth}
          message={t('taskPanel.loadFailed')}
          onRetry={() => setTaskPanelRetryKey((key) => key + 1)}
        >
          <Suspense fallback={<TaskPanelFallback isOpen={activeView === 'chat' && taskPanelOpen} width={taskPanelWidth} />}>
            <TaskPanel
              isOpen={activeView === 'chat' && taskPanelOpen}
              onClose={() => setTaskPanelOpen(false)}
              width={taskPanelWidth}
              onResize={(w) => setTaskPanelWidth(w)}
            />
          </Suspense>
        </TaskPanelErrorBoundary>
      )}
    </div>
  );
}
