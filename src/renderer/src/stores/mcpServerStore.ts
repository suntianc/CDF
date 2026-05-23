import { create } from 'zustand';
import { MCPServer } from '../../../shared/types';

interface MCPServerState {
  mcpServers: MCPServer[];
  isLoading: boolean;
  error: string | null;
  fetchMcpServers: () => Promise<void>;
  saveMcpServer: (server: Partial<MCPServer>) => Promise<void>;
  deleteMcpServer: (id: string) => Promise<void>;
  checkMcpHealth: (id: string) => Promise<{ ok: boolean; message?: string }>;
  toggleMcpConnection: (id: string, connected: boolean) => Promise<void>;
}

export const useMcpServerStore = create<MCPServerState>((set, get) => ({
  mcpServers: [],
  isLoading: false,
  error: null,

  fetchMcpServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const mcpServers = await window.electronAPI.db.getMcpServers();
      set({ mcpServers, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch MCP servers', isLoading: false });
    }
  },

  saveMcpServer: async (server) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.saveMcpServer(server);
      await get().fetchMcpServers();
    } catch (err: any) {
      set({ error: err.message || 'Failed to save MCP server', isLoading: false });
      throw err;
    }
  },

  deleteMcpServer: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.deleteMcpServer(id);
      await get().fetchMcpServers();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete MCP server', isLoading: false });
      throw err;
    }
  },

  checkMcpHealth: async (id) => {
    try {
      const result = await window.electronAPI.db.checkMcpHealth(id);
      await get().fetchMcpServers();
      return result;
    } catch (err: any) {
      await get().fetchMcpServers();
      return { ok: false, message: err.message || 'Health check request failed' };
    }
  },

  toggleMcpConnection: async (id, connected) => {
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.db.toggleMcpConnection(id, connected);
      await get().fetchMcpServers();
    } catch (err: any) {
      set({ error: err.message || 'Failed to toggle connection state', isLoading: false });
      throw err;
    }
  },
}));
