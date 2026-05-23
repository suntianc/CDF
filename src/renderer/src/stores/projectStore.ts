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
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
  setTaskPanelOpen: (open: boolean) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  taskPanelOpen: false,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setTaskPanelOpen: (open) => set({ taskPanelOpen: open }),
}));
