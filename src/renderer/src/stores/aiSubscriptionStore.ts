import { create } from 'zustand';
import type {
  AISubscriptionEntry,
  AISubscriptionEntryId,
  AISubscriptionLoginDescriptor,
  CapabilityId,
} from '@shared/ai-subscriptions';

interface AISubscriptionState {
  entries: AISubscriptionEntry[];
  isLoading: boolean;
  error: string | null;
  loginDescriptors: Partial<Record<AISubscriptionEntryId, AISubscriptionLoginDescriptor>>;
  fetchEntries: () => Promise<void>;
  setCapabilityEnabled: (
    entryId: AISubscriptionEntryId,
    capabilityId: CapabilityId,
    enabled: boolean
  ) => Promise<void>;
  connectWithKey: (entryId: AISubscriptionEntryId, subscriptionKey: string) => Promise<void>;
  startLogin: (
    entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>
  ) => Promise<void>;
  resumeLogin: (
    entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
    descriptor: AISubscriptionLoginDescriptor
  ) => void;
  disconnect: (entryId: AISubscriptionEntryId) => Promise<void>;
  refreshStatus: (entryId: AISubscriptionEntryId) => Promise<void>;
}

function getErrorMessage(error: unknown, fallbackKey: string): string {
  return error instanceof Error && error.message ? error.message : fallbackKey;
}

const activeLoginAttempts = new Map<AISubscriptionEntryId, string>();

function withoutLoginDescriptor(
  descriptors: Partial<Record<AISubscriptionEntryId, AISubscriptionLoginDescriptor>>,
  entryId: AISubscriptionEntryId
) {
  const next = { ...descriptors };
  delete next[entryId];
  return next;
}

export const useAISubscriptionStore = create<AISubscriptionState>((set, get) => ({
  entries: [],
  isLoading: false,
  error: null,
  loginDescriptors: {},

  fetchEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const [entries, loginDescriptors] = await Promise.all([
        window.electronAPI.aiSubscriptions.getEntries(),
        window.electronAPI.aiSubscriptions.getActiveLogins(),
      ]);
      for (const entryId of activeLoginAttempts.keys()) {
        if (!loginDescriptors[entryId]) activeLoginAttempts.delete(entryId);
      }
      set({ entries, loginDescriptors, isLoading: false });
      for (const [entryId, descriptor] of Object.entries(loginDescriptors) as Array<[
        Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
        AISubscriptionLoginDescriptor,
      ]>) {
        get().resumeLogin(entryId, descriptor);
      }
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

  resumeLogin: (entryId, descriptor) => {
    const { attemptId } = descriptor;
    if (activeLoginAttempts.get(entryId) === attemptId) return;
    activeLoginAttempts.set(entryId, attemptId);
    const pollUntilSettled = async (delayMs: number): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
      if (activeLoginAttempts.get(entryId) !== attemptId) return;
      try {
        const polled = await window.electronAPI.aiSubscriptions.pollLogin(entryId, attemptId);
        if (activeLoginAttempts.get(entryId) !== attemptId) return;
        const terminal = polled.status !== 'connecting';
        set((state) => ({
          entries: polled.entries,
          loginDescriptors: terminal
            ? withoutLoginDescriptor(state.loginDescriptors, entryId)
            : state.loginDescriptors,
        }));
        if (terminal) {
          activeLoginAttempts.delete(entryId);
          return;
        }
        void pollUntilSettled(polled.nextPollAfterMs ?? descriptor.pollIntervalMs);
      } catch (err: unknown) {
        activeLoginAttempts.delete(entryId);
        try {
          const entries = await window.electronAPI.aiSubscriptions.cancelLogin(entryId, attemptId);
          set((state) => ({
            entries,
            error: getErrorMessage(err, 'settings.aiSubscriptions.error.refreshStatusFailed'),
            loginDescriptors: withoutLoginDescriptor(state.loginDescriptors, entryId),
          }));
        } catch {
          set((state) => ({
            error: getErrorMessage(err, 'settings.aiSubscriptions.error.refreshStatusFailed'),
            loginDescriptors: withoutLoginDescriptor(state.loginDescriptors, entryId),
          }));
        }
      }
    };
    void pollUntilSettled(descriptor.pollIntervalMs);
  },

  startLogin: async (entryId) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.electronAPI.aiSubscriptions.startLogin(entryId);
      set((state) => ({
        entries: result.entries,
        isLoading: false,
        loginDescriptors: result.descriptor
          ? { ...state.loginDescriptors, [entryId]: result.descriptor }
          : state.loginDescriptors,
      }));
      if (result.descriptor) {
        void Promise.resolve(
          window.electronAPI.shell.openExternalUrl(result.descriptor.verificationUrl)
        ).catch(() => undefined);
        get().resumeLogin(entryId, result.descriptor);
      }
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'settings.aiSubscriptions.error.startLoginFailed'), isLoading: false });
      throw err;
    }
  },

  disconnect: async (entryId) => {
    activeLoginAttempts.delete(entryId);
    set({ isLoading: true, error: null });
    try {
      const descriptor = get().loginDescriptors[entryId];
      const entries = descriptor && (entryId === 'codex-oauth' || entryId === 'xai-oauth')
        ? await window.electronAPI.aiSubscriptions.cancelLogin(entryId, descriptor.attemptId)
        : await window.electronAPI.aiSubscriptions.disconnect(entryId);
      set((state) => ({
        entries,
        isLoading: false,
        loginDescriptors: withoutLoginDescriptor(state.loginDescriptors, entryId),
      }));
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
