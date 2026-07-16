import { create } from 'zustand';
import type {
  Agent,
  CreateCustomAgentInput,
  MasterScenePrompt,
  SaveMasterScenePromptsInput,
  UpdateCustomAgentInput,
  UpdateGeneralPurposeAgentInput,
} from '../../../shared/types';

interface AgentState {
  agents: Agent[];
  masterScenePrompts: MasterScenePrompt[];
  isLoading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchMasterScenePrompts: () => Promise<void>;
  createCustomAgent: (agent: CreateCustomAgentInput) => Promise<void>;
  updateCustomAgent: (id: string, agent: UpdateCustomAgentInput) => Promise<void>;
  updateGeneralPurposeAgent: (agent: UpdateGeneralPurposeAgentInput) => Promise<void>;
  saveMasterScenePrompts: (changes: SaveMasterScenePromptsInput[]) => Promise<void>;
  deleteCustomAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  masterScenePrompts: [],
  isLoading: false,
  error: null,

  fetchAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const agents = await window.electronAPI.db.getAgents();
      set({ agents, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch agents', isLoading: false });
    }
  },

  fetchMasterScenePrompts: async () => {
    try {
      const masterScenePrompts = await window.electronAPI.db.getMasterScenePrompts();
      set({ masterScenePrompts });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch Master Agent prompts' });
    }
  },

  createCustomAgent: async (agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.createCustomAgent(agent);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to create agent', isLoading: false });
      throw err;
    }
  },

  updateCustomAgent: async (id, agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.updateCustomAgent(id, agent);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save agent', isLoading: false });
      throw err;
    }
  },

  updateGeneralPurposeAgent: async (agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.updateGeneralPurposeAgent(agent);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save General-purpose Agent', isLoading: false });
      throw err;
    }
  },

  saveMasterScenePrompts: async (changes) => {
    set({ isLoading: true, error: null });
    try {
      const masterScenePrompts = await window.electronAPI.db.saveMasterScenePrompts(changes);
      set({ masterScenePrompts, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to save Master Agent prompts', isLoading: false });
      throw err;
    }
  },

  deleteCustomAgent: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteCustomAgent(id);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete agent', isLoading: false });
      throw err;
    }
  },
}));
