import type { ConversationModelSourceType } from '@shared/types';
import type { ReasoningEffort } from '@shared/ai-subscriptions';
import type { SessionSliceContext, SessionState } from './types';

// Session-level model overrides are durable local business data and belong in the main
// process store (electron-store), not renderer localStorage (AGENTS.md). Kept in-memory in
// the Zustand store for fast reads; writes are mirrored to the main store (fire-and-forget)
// and hydrated once at startup.
const SESSION_MODEL_OVERRIDES_KEY = 'sessionModelOverrides';

export function persistSessionModelOverrides(overrides: unknown): void {
  // Fire-and-forget: a persistence failure (or an unavailable bridge) must never break the
  // in-memory state update. Optional chaining + Promise.resolve tolerate a missing store or a
  // non-thenable return.
  try {
    Promise.resolve(window.electronAPI.store?.set?.(SESSION_MODEL_OVERRIDES_KEY, overrides)).catch((err) => {
      console.error('Failed to persist sessionModelOverrides to the main store:', err);
    });
  } catch (err) {
    console.error('Failed to persist sessionModelOverrides to the main store:', err);
  }
}

export type ModelOverridesSlice = Pick<SessionState,
  | 'sessionModelOverrides'
  | 'setSessionModelOverride'
  | 'setSessionReasoningEffort'
  | 'hydrateSessionModelOverrides'
>;

export function createModelOverridesSlice({ set }: SessionSliceContext): ModelOverridesSlice {
  return {
    // Empty until hydrateSessionModelOverrides loads it from the main store at startup.
    sessionModelOverrides: {},

    setSessionModelOverride: (
      sessionId: string,
      sourceId: string,
      model: string,
      sourceType: ConversationModelSourceType = 'llm_provider'
    ) => {
      set((state) => {
        const reasoningEffort = sourceId && model
          ? state.sessionModelOverrides[sessionId]?.reasoningEffort
          : undefined;
        const nextOverrides = {
          ...state.sessionModelOverrides,
          [sessionId]: {
            providerId: sourceId,
            sourceId,
            sourceType,
            model,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        };
        persistSessionModelOverrides(nextOverrides);
        return { sessionModelOverrides: nextOverrides };
      });
    },

    setSessionReasoningEffort: (sessionId: string, effort?: ReasoningEffort) => {
      set((state) => {
        const current = state.sessionModelOverrides[sessionId];
        if (!current) return state;
        const nextOverride = { ...current };
        if (effort) {
          nextOverride.reasoningEffort = effort;
        } else {
          delete nextOverride.reasoningEffort;
        }
        const nextOverrides = {
          ...state.sessionModelOverrides,
          [sessionId]: nextOverride,
        };
        persistSessionModelOverrides(nextOverrides);
        return { sessionModelOverrides: nextOverrides };
      });
    },

    hydrateSessionModelOverrides: async () => {
      try {
        const saved = await window.electronAPI.store.get(SESSION_MODEL_OVERRIDES_KEY);
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
          set({ sessionModelOverrides: saved as SessionState['sessionModelOverrides'] });
        }
      } catch (err) {
        console.error('Failed to hydrate sessionModelOverrides from the main store:', err);
      }
    },
  };
}
