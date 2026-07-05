import { Component, Suspense, lazy, useMemo, useState, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/ChatArea/ChatArea';
import { ModelSettings } from './components/Settings/ModelSettings';
import { ToolSettings } from './components/Settings/ToolSettings';
import { ResearchSettings } from './components/Settings/ResearchSettings';
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
import { PanelLeft, PanelRight } from 'lucide-react';
import { useFileStore } from './stores/fileStore';
import { Toaster } from 'sonner';
import type { TaskPanelProps } from './components/TaskPanel/TaskPanel';
import { FilePanel } from './components/FilePanel/FilePanel';
import { SceneWorkspace } from './components/SceneWorkspace/SceneWorkspace';
import { normalizeProjectScene } from './scenes/sceneRouting';

const loadTaskPanel = () => import('./components/TaskPanel/TaskPanel').then((mod) => ({ default: mod.TaskPanel }));

function TaskPanelFallback({ isOpen }: Pick<TaskPanelProps, 'isOpen'>) {
  const { t } = useTranslation();
  if (!isOpen) return null;
  return (
    <div className="w-[360px] bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg">
      <div className="h-24 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
        {t('taskPanel.loading')}
      </div>
    </div>
  );
}

class TaskPanelErrorBoundary extends Component<
  { children: ReactNode; isOpen: boolean; message: string; onRetry: () => void },
  { hasError: boolean; wasOpen: boolean }
> {
  constructor(props: { children: ReactNode; isOpen: boolean; message: string; onRetry: () => void }) {
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
    if (!this.props.isOpen) return null;
    return (
      <div className="w-[360px] bg-[var(--color-bg-surface)] border border-[var(--color-danger)]/30 rounded-lg shadow-lg">
        <div className="h-24 flex items-center justify-center px-4 text-xs text-[var(--color-danger)] text-center">
          {this.props.message}
        </div>
      </div>
    );
  }
}

function FilePanelToggleButton() {
  const { t } = useTranslation();
  const filePanelOpen = useFileStore((s) => s.filePanelOpen);
  const toggleFilePanel = useFileStore((s) => s.toggleFilePanel);
  return (
    <button
      onClick={toggleFilePanel}
      className={`absolute top-[5px] right-[8px] w-6 h-6 flex items-center justify-center cursor-pointer z-[9999] rounded-full transition-all no-drag after:absolute after:inset-[-8px] after:content-[''] border ${
        filePanelOpen
          ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border-[var(--color-border)] shadow-sm opacity-100'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] border-transparent opacity-60 hover:opacity-100'
      }`}
      title={t('filePanel.togglePanel', '文件面板')}
      aria-label={t('filePanel.togglePanel', '文件面板')}
    >
      <PanelRight className="w-4 h-4" />
    </button>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const { activeView, setActiveView, taskPanelOpen, setTaskPanelOpen, projects, currentProjectId } = useProjectStore();
  const { theme, setTheme } = useTheme();
  const pendingApproval = useSessionStore((state) => state.pendingApproval);
  const [taskPanelMounted, setTaskPanelMounted] = useState(false);
  const [taskPanelRetryKey, setTaskPanelRetryKey] = useState(0);
  const TaskPanel = useMemo(() => lazy(loadTaskPanel), [taskPanelRetryKey]);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const { setCurrentWorkflow } = useWorkflowStore();
  const isEditingWorkflow = activeView === 'workflows' && !!editingWorkflow;
  const currentProject = projects.find((project) => project.id === currentProjectId);
  const currentScene = normalizeProjectScene(currentProject?.scene);

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

      <main className="flex-1 flex min-w-0 overflow-hidden relative">
        <div
          key={activeView === 'workflows' ? `${activeView}-${editingWorkflow ? 'editor' : 'list'}` : activeView}
          className="flex-1 flex flex-col h-full overflow-hidden animate-fade-up min-w-[40%]"
        >
          {activeView === 'settings' && <ModelSettings />}
          {activeView === 'tools' && <ToolSettings />}
          {activeView === 'research' && <ResearchSettings />}
          {activeView === 'system' && <SystemSettings />}
          {activeView === 'agents' && <AgentLibrary />}
          {activeView === 'plugins' && <PluginsPanel />}
          {activeView === 'chat' && (
            <SceneWorkspace
              scene={currentScene}
              conversation={(
                <ChatArea
                  onOpenSettings={() => setActiveView('settings')}
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={() => setSidebarCollapsed(false)}
                  taskPanelOpen={taskPanelOpen}
                  onToggleTaskPanel={() => setTaskPanelOpen(!taskPanelOpen)}
                  onOpenTaskPanel={() => setTaskPanelOpen(true)}
                />
              )}
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

        {activeView === 'chat' && <FilePanel />}
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

      {activeView === 'chat' && <FilePanelToggleButton />}
      <Toaster richColors position="bottom-right" theme={theme === 'system' ? 'system' : theme} />
      <ContextModal />

      {taskPanelMounted && (
        <div
          className={`task-panel-container absolute top-14 z-50 transition-[right] duration-300 ease-in-out ${
            activeView === 'chat' && taskPanelOpen ? '' : 'pointer-events-none'
          }`}
          style={{ right: 'calc(var(--file-panel-width, 0px) + 8px)' }}
        >
          <TaskPanelErrorBoundary
            isOpen={activeView === 'chat' && taskPanelOpen}
            message={t('taskPanel.loadFailed')}
            onRetry={() => setTaskPanelRetryKey((key) => key + 1)}
          >
            <Suspense fallback={<TaskPanelFallback isOpen={activeView === 'chat' && taskPanelOpen} />}>
              <TaskPanel
                isOpen={activeView === 'chat' && taskPanelOpen}
                onClose={() => setTaskPanelOpen(false)}
              />
            </Suspense>
          </TaskPanelErrorBoundary>
        </div>
      )}
    </div>
  );
}
