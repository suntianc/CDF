import { create } from 'zustand';
import { Skill } from '../../../shared/types';

interface SkillState {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  fetchSkills: (projectId: string) => Promise<void>;
  saveSkill: (projectId: string, skill: Partial<Skill>) => Promise<void>;
  deleteSkill: (projectId: string, id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  isLoading: false,
  error: null,

  fetchSkills: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const skills = await window.electronAPI.db.getSkills(projectId);
      set({ skills, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch skills', isLoading: false });
    }
  },

  saveSkill: async (projectId, skill) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveSkill(projectId, skill);
      await get().fetchSkills(projectId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to save skill', isLoading: false });
      throw err;
    }
  },

  deleteSkill: async (projectId, id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteSkill(projectId, id);
      await get().fetchSkills(projectId);
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete skill', isLoading: false });
      throw err;
    }
  },
}));