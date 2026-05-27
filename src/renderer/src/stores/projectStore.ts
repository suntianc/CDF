import { create } from 'zustand';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  taskPanelOpen: boolean;
  activeView: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows';
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
  setTaskPanelOpen: (open: boolean) => void;
  setActiveView: (view: 'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows') => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  taskPanelOpen: false,
  activeView: 'chat',
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setTaskPanelOpen: (open) => set({ taskPanelOpen: open }),
  setActiveView: (view) => set((state) => ({
    activeView: view,
    taskPanelOpen: view === 'chat' ? state.taskPanelOpen : false,
  })),
}));
