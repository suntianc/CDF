import { create } from 'zustand';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  setProjects: (projects: Project[]) => void;
  setCurrentProject: (id: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProjectId: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
}));
