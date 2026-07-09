import { create } from 'zustand';
import type {
  AISubscriptionEntry,
  AISubscriptionEntryId,
  CapabilityId,
} from '@shared/ai-subscriptions';

interface AISubscriptionState {
  entries: AISubscriptionEntry[];
  isLoading: boolean;
  error: string | null;
  fetchEntries: () => Promise<void>;
  setCapabilityEnabled: (
    entryId: AISubscriptionEntryId,
    capabilityId: CapabilityId,
    enabled: boolean
  ) => Promise<void>;
  connectWithKey: (entryId: AISubscriptionEntryId, subscriptionKey: string) => Promise<void>;
  disconnect: (entryId: AISubscriptionEntryId) => Promise<void>;
  refreshStatus: (entryId: AISubscriptionEntryId) => Promise<void>;
}

function getErrorMessage(error: unknown, fallbackKey: string): string {
  return error instanceof Error && error.message ? error.message : fallbackKey;
}

export const useAISubscriptionStore = create<AISubscriptionState>((set) => ({
  entries: [],
  isLoading: false,
  error: null,

  fetchEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const entries = await window.electronAPI.aiSubscriptions.getEntries();
      set({ entries, isLoading: false });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.loadFailed'), isLoading: false });
    }
  },

  setCapabilityEnabled: async (entryId, capabilityId, enabled) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await window.electronAPI.aiSubscriptions.setCapabilityEnabled(
        entryId,
        capabilityId,
        enabled
      );
      set({ entries, isLoading: false });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.updateCapabilityFailed'), isLoading: false });
      throw err;
    }
  },

  connectWithKey: async (entryId, subscriptionKey) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await window.electronAPI.aiSubscriptions.connectWithKey(entryId, subscriptionKey);
      set({ entries, isLoading: false });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.startLoginFailed'), isLoading: false });
      throw err;
    }
  },

  disconnect: async (entryId) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await window.electronAPI.aiSubscriptions.disconnect(entryId);
      set({ entries, isLoading: false });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.startLoginFailed'), isLoading: false });
      throw err;
    }
  },

  refreshStatus: async (entryId) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await window.electronAPI.aiSubscriptions.refreshStatus(entryId);
      set({ entries, isLoading: false });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.refreshStatusFailed'), isLoading: false });
      throw err;
    }
  },
}));
