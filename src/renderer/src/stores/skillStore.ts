import { create } from 'zustand';
import { Skill, SkillVersion } from '../../../shared/types';

interface SkillState {
  skills: Skill[];
  activeSkillVersions: SkillVersion[];
  isLoading: boolean;
  error: string | null;
  fetchSkills: () => Promise<void>;
  saveSkill: (skill: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  fetchSkillVersions: (skillId: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  activeSkillVersions: [],
  isLoading: false,
  error: null,

  fetchSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const skills = await window.electronAPI.db.getSkills();
      set({ skills, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch skills', isLoading: false });
    }
  },

  saveSkill: async (skill) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveSkill(skill);
      await get().fetchSkills();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save skill', isLoading: false });
      throw err;
    }
  },

  deleteSkill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteSkill(id);
      await get().fetchSkills();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete skill', isLoading: false });
      throw err;
    }
  },

  fetchSkillVersions: async (skillId) => {
    set({ isLoading: true, error: null });
    try {
      const versions = await window.electronAPI.db.getSkillVersions(skillId);
      set({ activeSkillVersions: versions, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch skill versions', isLoading: false });
    }
  },
}));
