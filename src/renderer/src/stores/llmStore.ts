import { create } from 'zustand';
import { LLMProvider } from '../../../shared/types';

interface LLMState {
  providers: LLMProvider[];
  activeProvider: LLMProvider | null;
  isLoading: boolean;
  error: string | null;
  fetchProviders: () => Promise<void>;
  saveProvider: (provider: any) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setActiveProvider: (id: string) => Promise<void>;
}

export const useLLMStore = create<LLMState>((set, get) => ({
  providers: [],
  activeProvider: null,
  isLoading: false,
  error: null,

  fetchProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await window.electronAPI.db.getProviders();
      const active = providers.find((p) => p.is_active === 1) || null;
      set({ providers, activeProvider: active, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch providers', isLoading: false });
    }
  },

  saveProvider: async (provider) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveProvider(provider);
      await get().fetchProviders();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save provider', isLoading: false });
      throw err;
    }
  },

  deleteProvider: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteProvider(id);
      await get().fetchProviders();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete provider', isLoading: false });
      throw err;
    }
  },

  setActiveProvider: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.setActiveProvider(id);
      await get().fetchProviders();
    } catch (err: any) {
      set({ error: err.message || 'Failed to set active provider', isLoading: false });
      throw err;
    }
  },
}));
