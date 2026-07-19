import { create } from 'zustand';
import type { Project } from '@shared/types';

export type AppView = 'chat' | 'settings' | 'ai-subscriptions' | 'agents' | 'plugins' | 'tools' | 'research' | 'workflows' | 'system';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  taskPanelOpen: boolean;
  activeView: AppView;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
  setTaskPanelOpen: (open: boolean) => void;
  setActiveView: (view: AppView) => void;
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
