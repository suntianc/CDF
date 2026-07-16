import { create } from 'zustand';
import type {
  Agent,
  CreateCustomAgentInput,
  MasterScenePrompt,
  SaveMasterScenePromptsInput,
  UpdateCustomAgentInput,
  UpdateGeneralPurposeAgentInput,
} from '../../../shared/types';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface AgentState {
  agents: Agent[];
  masterScenePrompts: MasterScenePrompt[];
  isLoading: boolean;
  error: string | null;
  isMasterPromptsLoading: boolean;
  masterPromptsError: string | null;
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
  isMasterPromptsLoading: false,
  masterPromptsError: null,

  fetchAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const agents = await window.electronAPI.db.getAgents();
      set({ agents, isLoading: false });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to fetch agents'), isLoading: false });
    }
  },

  fetchMasterScenePrompts: async () => {
    set({ isMasterPromptsLoading: true, masterPromptsError: null });
    try {
      const masterScenePrompts = await window.electronAPI.db.getMasterScenePrompts();
      set({ masterScenePrompts, isMasterPromptsLoading: false });
    } catch (error: unknown) {
      set({
        masterPromptsError: getErrorMessage(error, 'Failed to fetch Master Agent prompts'),
        isMasterPromptsLoading: false,
      });
    }
  },

  createCustomAgent: async (agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.createCustomAgent(agent);
      await get().fetchAgents();
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to create agent'), isLoading: false });
      throw error;
    }
  },

  updateCustomAgent: async (id, agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.updateCustomAgent(id, agent);
      await get().fetchAgents();
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to save agent'), isLoading: false });
      throw error;
    }
  },

  updateGeneralPurposeAgent: async (agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.updateGeneralPurposeAgent(agent);
      await get().fetchAgents();
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to save General-purpose Agent'), isLoading: false });
      throw error;
    }
  },

  saveMasterScenePrompts: async (changes) => {
    set({ isLoading: true, error: null });
    try {
      const masterScenePrompts = await window.electronAPI.db.saveMasterScenePrompts(changes);
      set({ masterScenePrompts, isLoading: false });
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to save Master Agent prompts'), isLoading: false });
      throw error;
    }
  },

  deleteCustomAgent: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteCustomAgent(id);
      await get().fetchAgents();
    } catch (error: unknown) {
      set({ error: getErrorMessage(error, 'Failed to delete agent'), isLoading: false });
      throw error;
    }
  },
}));
