import { create } from 'zustand';
import { Skill, SkillSaveInput } from '../../../shared/types';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface SkillState {
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  fetchSkills: (projectId: string) => Promise<void>;
  fetchGlobalSkills: () => Promise<void>;
  saveSkill: (projectId: string, skill: SkillSaveInput) => Promise<void>;
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
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to fetch skills'), isLoading: false });
    }
  },

  fetchGlobalSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const skills = await window.electronAPI.db.getGlobalSkills();
      set({ skills, isLoading: false });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to fetch global skills'), isLoading: false });
    }
  },

  saveSkill: async (projectId, skill) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveSkill(projectId, skill);
      await get().fetchSkills(projectId);
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to save skill'), isLoading: false });
      throw error;
    }
  },

  deleteSkill: async (projectId, id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteSkill(projectId, id);
      await get().fetchSkills(projectId);
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to delete skill'), isLoading: false });
      throw error;
    }
  },
}));