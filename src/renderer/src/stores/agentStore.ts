import { create } from 'zustand';
import { Agent } from '../../../shared/types';

interface AgentState {
  agents: Agent[];
  isLoading: boolean;
  error: string | null;
  fetchAgents: (projectId: string) => Promise<void>;
  saveAgent: (agent: Partial<Agent> & { project_id: string; mcpServerIds?: string[]; skillNames?: string[] }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  isLoading: false,
  error: null,

  fetchAgents: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const agents = await window.electronAPI.db.getAgents(projectId);
      set({ agents, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch agents', isLoading: false });
    }
  },

  saveAgent: async (agent) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveAgent(agent);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save agent', isLoading: false });
      throw err;
    }
  },

  deleteAgent: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteAgent(id);
      await get().fetchAgents();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete agent', isLoading: false });
      throw err;
    }
  },
}));
