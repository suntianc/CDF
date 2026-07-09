import store from './store';
import {
  buildAISubscriptionEntries,
  selectAISubscriptionCapabilityRoutes,
  setAISubscriptionCapabilityEnabled,
  setAISubscriptionConnectionResult,
  setAISubscriptionStatus,
  type AISubscriptionConnectionResult,
  type AISubscriptionConnectionStatus,
  type AISubscriptionEntry,
  type AISubscriptionEntryId,
  type CapabilityId,
  type PersistedAISubscriptionState,
} from '../shared/ai-subscriptions';
import {
  connectMiniMaxTokenPlan,
  type MiniMaxAdapterDeps,
} from './ai-subscription-adapters';
import { clearSubscriptionSecret, getSubscriptionSecret, setSubscriptionSecret } from './ai-subscription-credentials';

const STORE_KEY = 'aiSubscriptions';

function readPersistedState(): PersistedAISubscriptionState {
  const value = store.get(STORE_KEY) as PersistedAISubscriptionState | undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function writePersistedState(next: PersistedAISubscriptionState): void {
  store.set(STORE_KEY, next);
}

export function getAISubscriptionEntries(): AISubscriptionEntry[] {
  return buildAISubscriptionEntries(reconcileWithCredentials(readPersistedState()));
}

// Invariant: an account can only be settled (connected/expired/unavailable) if
// it holds a vaulted credential — heals stale persisted "connected" state.
const CREDENTIALLESS_STALE_STATUSES = new Set<AISubscriptionConnectionStatus>([
  'connected',
  'expired',
  'unavailable',
  'connecting',
]);

function isStaleStatus(entryId: AISubscriptionEntryId, status: AISubscriptionConnectionStatus): boolean {
  return CREDENTIALLESS_STALE_STATUSES.has(status) && !getSubscriptionSecret(entryId);
}

function reconcileWithCredentials(persisted: PersistedAISubscriptionState): PersistedAISubscriptionState {
  const entries = persisted.entries;
  if (!entries) return persisted;
  let changed = false;
  const next: NonNullable<PersistedAISubscriptionState['entries']> = {};
  for (const [id, state] of Object.entries(entries) as [AISubscriptionEntryId, typeof entries[AISubscriptionEntryId]][]) {
    // Drop unknown entry ids left over from removed providers (codex/xai/antigravity).
    if (id !== 'minimax-token-plan') {
      changed = true;
      continue;
    }
    if (state?.status && isStaleStatus(id, state.status)) {
      next[id] = { ...state, status: 'logged_out' };
      changed = true;
    } else {
      next[id] = state;
    }
  }
  return changed ? { ...persisted, entries: next } : persisted;
}

export function saveAISubscriptionCapabilityState(
  entryId: AISubscriptionEntryId,
  capabilityId: CapabilityId,
  enabled: boolean
): AISubscriptionEntry[] {
  const next = setAISubscriptionCapabilityEnabled(
    readPersistedState(),
    entryId,
    capabilityId,
    enabled
  );
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export function saveAISubscriptionStatus(
  entryId: AISubscriptionEntryId,
  status: AISubscriptionConnectionStatus
): AISubscriptionEntry[] {
  const next = setAISubscriptionStatus(readPersistedState(), entryId, status);
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

const defaultMiniMaxAdapterDeps: MiniMaxAdapterDeps = {
  httpGetJson: async (url, headers) => {
    const response = await fetch(url, { method: 'GET', headers });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  },
};

export async function connectAISubscriptionWithKey(
  entryId: AISubscriptionEntryId,
  subscriptionKey: string,
  deps: MiniMaxAdapterDeps = defaultMiniMaxAdapterDeps
): Promise<AISubscriptionEntry[]> {
  if (entryId !== 'minimax-token-plan') {
    throw new Error(`Subscription key login is only supported for MiniMax Token Plan (got ${entryId})`);
  }
  setSubscriptionSecret(entryId, subscriptionKey);
  const result = await connectMiniMaxTokenPlan(subscriptionKey, deps);
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, result);
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export function disconnectAISubscription(entryId: AISubscriptionEntryId): AISubscriptionEntry[] {
  clearSubscriptionSecret(entryId);
  const next = setAISubscriptionStatus(readPersistedState(), entryId, 'logged_out');
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export async function refreshAISubscriptionStatus(
  entryId: AISubscriptionEntryId,
  deps: MiniMaxAdapterDeps = defaultMiniMaxAdapterDeps
): Promise<AISubscriptionEntry[]> {
  const result = entryId === 'minimax-token-plan'
    ? await refreshMiniMaxTokenPlan(deps)
    : { status: 'logged_out' as const };
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, result);
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

async function refreshMiniMaxTokenPlan(deps: MiniMaxAdapterDeps): Promise<AISubscriptionConnectionResult> {
  const key = getSubscriptionSecret('minimax-token-plan');
  if (!key) {
    return { status: 'logged_out' };
  }
  return connectMiniMaxTokenPlan(key, deps);
}

export function getAISubscriptionCapabilityRoutes(capabilityId: CapabilityId) {
  return selectAISubscriptionCapabilityRoutes(getAISubscriptionEntries(), capabilityId);
}
