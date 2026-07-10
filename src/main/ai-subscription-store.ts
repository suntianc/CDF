import store from './store';
import {
  AI_SUBSCRIPTION_ENTRY_IDS,
  buildAISubscriptionEntries,
  selectAISubscriptionCapabilityRoutes,
  setAISubscriptionCapabilityEnabled,
  setAISubscriptionConnectionResult,
  setAISubscriptionStatus,
  type AISubscriptionConnectionResult,
  type AISubscriptionConnectionStatus,
  type AISubscriptionEntry,
  type AISubscriptionEntryId,
  type AISubscriptionLoginDescriptor,
  type AISubscriptionLoginPollResult,
  type AISubscriptionLoginStartResult,
  type CapabilityId,
  type PersistedAISubscriptionState,
} from '../shared/ai-subscriptions';
import {
  connectMiniMaxTokenPlan,
  getDefaultOAuthAdapter,
  type MiniMaxAdapterDeps,
} from './ai-subscription-adapters';
import {
  clearSubscriptionSecret,
  getOAuthCredential,
  getSubscriptionSecret,
  setSubscriptionSecret,
} from './ai-subscription-credentials';

const STORE_KEY = 'aiSubscriptions';
type OAuthSubscriptionEntryId = Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>;
const activeOAuthLoginDescriptors = new Map<OAuthSubscriptionEntryId, AISubscriptionLoginDescriptor>();
const oauthLoginPollFlights = new Map<string, Promise<AISubscriptionLoginPollResult>>();
const authGenerations = new Map<AISubscriptionEntryId, number>();
const statusOperationRevisions = new Map<AISubscriptionEntryId, number>();

function advanceAuthGeneration(entryId: AISubscriptionEntryId): number {
  const next = (authGenerations.get(entryId) ?? 0) + 1;
  authGenerations.set(entryId, next);
  return next;
}

function currentAuthGeneration(entryId: AISubscriptionEntryId): number {
  return authGenerations.get(entryId) ?? 0;
}

function isCurrentAuthGeneration(entryId: AISubscriptionEntryId, generation: number): boolean {
  return currentAuthGeneration(entryId) === generation;
}

function advanceStatusOperationRevision(entryId: AISubscriptionEntryId): number {
  const next = (statusOperationRevisions.get(entryId) ?? 0) + 1;
  statusOperationRevisions.set(entryId, next);
  return next;
}

function isCurrentStatusOperation(
  entryId: AISubscriptionEntryId,
  generation: number,
  revision: number
): boolean {
  return isCurrentAuthGeneration(entryId, generation)
    && (statusOperationRevisions.get(entryId) ?? 0) === revision;
}

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
  const persisted = readPersistedState();
  const reconciled = reconcileWithCredentials(persisted);
  if (reconciled !== persisted) writePersistedState(reconciled);
  return buildAISubscriptionEntries(reconciled);
}

export function getActiveAISubscriptionLoginDescriptors(): Partial<
  Record<OAuthSubscriptionEntryId, AISubscriptionLoginDescriptor>
> {
  return Object.fromEntries(activeOAuthLoginDescriptors.entries());
}

// Invariant: an account can only be settled (connected/expired/unavailable) if
// it holds a vaulted credential — heals stale persisted "connected" state.
const CREDENTIALLESS_STALE_STATUSES = new Set<AISubscriptionConnectionStatus>([
  'connected',
  'expired',
  'unavailable',
]);

function hasStoredCredential(entryId: AISubscriptionEntryId): boolean {
  if (entryId === 'minimax-token-plan') return Boolean(getSubscriptionSecret(entryId));
  return Boolean(getOAuthCredential(entryId));
}

function isStaleStatus(entryId: AISubscriptionEntryId, status: AISubscriptionConnectionStatus): boolean {
  if (
    status === 'connecting'
    && entryId !== 'minimax-token-plan'
    && !activeOAuthLoginDescriptors.has(entryId)
  ) {
    return true;
  }
  return CREDENTIALLESS_STALE_STATUSES.has(status) && !hasStoredCredential(entryId);
}

function reconcileWithCredentials(persisted: PersistedAISubscriptionState): PersistedAISubscriptionState {
  const entries = persisted.entries;
  if (!entries) return persisted;
  let changed = false;
  const next: NonNullable<PersistedAISubscriptionState['entries']> = {};
  const supportedEntryIds = new Set<string>(AI_SUBSCRIPTION_ENTRY_IDS);
  for (const [id, state] of Object.entries(entries) as [AISubscriptionEntryId, typeof entries[AISubscriptionEntryId]][]) {
    // Drop unknown entry ids left over from removed providers.
    if (!supportedEntryIds.has(id)) {
      changed = true;
      continue;
    }
    const credential = id === 'minimax-token-plan' ? undefined : getOAuthCredential(id);
    const reconciledStatus = credential?.terminalStatus && state?.status !== 'logged_out'
      ? credential.terminalStatus
      : state?.status && isStaleStatus(id, state.status)
        ? 'logged_out'
        : state?.status;
    if (reconciledStatus !== state?.status) {
      next[id] = { ...state, status: reconciledStatus };
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
  advanceStatusOperationRevision(entryId);
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
  const generation = advanceAuthGeneration(entryId);
  advanceStatusOperationRevision(entryId);
  setSubscriptionSecret(entryId, subscriptionKey);
  const result = await connectMiniMaxTokenPlan(subscriptionKey, deps);
  if (!isCurrentAuthGeneration(entryId, generation)) return getAISubscriptionEntries();
  advanceStatusOperationRevision(entryId);
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, result);
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

interface OAuthLoginStarter {
  startLogin: () => Promise<{
    status: 'connecting';
    descriptor: AISubscriptionLoginDescriptor;
  }>;
  cancelLogin?: (attemptId: string) => Promise<void>;
}

export async function startAISubscriptionLogin(
  entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
  adapter: OAuthLoginStarter = getDefaultOAuthAdapter(entryId)
): Promise<AISubscriptionLoginStartResult> {
  const generation = advanceAuthGeneration(entryId);
  advanceStatusOperationRevision(entryId);
  const previous = activeOAuthLoginDescriptors.get(entryId);
  if (previous) {
    activeOAuthLoginDescriptors.delete(entryId);
    await adapter.cancelLogin?.(previous.attemptId);
    if (!isCurrentAuthGeneration(entryId, generation)) {
      const active = activeOAuthLoginDescriptors.get(entryId);
      if (active) return { entries: getAISubscriptionEntries(), descriptor: active };
      throw new Error('AI subscription login attempt was superseded');
    }
  }
  const started = await adapter.startLogin();
  if (!isCurrentAuthGeneration(entryId, generation)) {
    await adapter.cancelLogin?.(started.descriptor.attemptId);
    const active = activeOAuthLoginDescriptors.get(entryId);
    if (active) {
      return { entries: getAISubscriptionEntries(), descriptor: active };
    }
    throw new Error('AI subscription login attempt was superseded');
  }
  // A new device attempt supersedes any expired/quarantined credential. Clear
  // it only after the provider successfully issued a user code, so a failed
  // start does not destroy an otherwise recoverable account.
  advanceStatusOperationRevision(entryId);
  clearSubscriptionSecret(entryId);
  activeOAuthLoginDescriptors.set(entryId, started.descriptor);
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, {
    status: started.status,
    usageSummaries: [],
  });
  writePersistedState(next);
  return {
    entries: buildAISubscriptionEntries(next),
    descriptor: started.descriptor,
  };
}

interface OAuthLoginPoller {
  pollLoginStatus: (attemptId: string) => Promise<
    | { status: 'connecting'; nextPollAfterMs: number }
    | { status: 'connected' }
    | { status: 'logged_out'; reason?: string }
    | { status: 'expired'; message?: string }
    | { status: 'unavailable'; message?: string }
  >;
}

export function pollAISubscriptionLogin(
  entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
  attemptId: string,
  adapter: OAuthLoginPoller = getDefaultOAuthAdapter(entryId)
): Promise<AISubscriptionLoginPollResult> {
  const flightKey = `${entryId}\0${attemptId}`;
  const existing = oauthLoginPollFlights.get(flightKey);
  if (existing) return existing;
  const flight = pollAISubscriptionLoginOnce(entryId, attemptId, adapter).finally(() => {
    if (oauthLoginPollFlights.get(flightKey) === flight) {
      oauthLoginPollFlights.delete(flightKey);
    }
  });
  oauthLoginPollFlights.set(flightKey, flight);
  return flight;
}

async function pollAISubscriptionLoginOnce(
  entryId: OAuthSubscriptionEntryId,
  attemptId: string,
  adapter: OAuthLoginPoller
): Promise<AISubscriptionLoginPollResult> {
  const activeBeforePoll = activeOAuthLoginDescriptors.get(entryId);
  if (activeBeforePoll?.attemptId !== attemptId) {
    return currentLoginPollResult(entryId);
  }
  const generation = currentAuthGeneration(entryId);
  const revision = advanceStatusOperationRevision(entryId);
  const polled = await adapter.pollLoginStatus(attemptId);
  const activeAfterPoll = activeOAuthLoginDescriptors.get(entryId);
  if (
    !isCurrentStatusOperation(entryId, generation, revision)
    || activeAfterPoll?.attemptId !== attemptId
  ) {
    return currentLoginPollResult(entryId);
  }
  if (polled.status !== 'connecting') {
    activeOAuthLoginDescriptors.delete(entryId);
  }
  const next = setAISubscriptionStatus(readPersistedState(), entryId, polled.status);
  writePersistedState(next);
  return {
    entries: buildAISubscriptionEntries(next),
    status: polled.status,
    ...('nextPollAfterMs' in polled ? { nextPollAfterMs: polled.nextPollAfterMs } : {}),
    ...('reason' in polled && polled.reason ? { reason: polled.reason } : {}),
    ...('message' in polled && polled.message ? { message: polled.message } : {}),
  };
}

function currentLoginPollResult(entryId: OAuthSubscriptionEntryId): AISubscriptionLoginPollResult {
  const entries = getAISubscriptionEntries();
  return {
    entries,
    status: entries.find((entry) => entry.id === entryId)?.status ?? 'logged_out',
  };
}

export async function cancelAISubscriptionLogin(
  entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
  attemptId: string,
  adapter: { cancelLogin: (attemptId: string) => Promise<void> } = getDefaultOAuthAdapter(entryId)
): Promise<AISubscriptionEntry[]> {
  const activeBeforeCancel = activeOAuthLoginDescriptors.get(entryId);
  const generation = activeBeforeCancel?.attemptId === attemptId
    ? advanceAuthGeneration(entryId)
    : undefined;
  if (generation !== undefined) {
    advanceStatusOperationRevision(entryId);
    activeOAuthLoginDescriptors.delete(entryId);
  }
  await adapter.cancelLogin(attemptId);
  if (
    generation === undefined
    || !isCurrentAuthGeneration(entryId, generation)
  ) {
    return getAISubscriptionEntries();
  }
  advanceStatusOperationRevision(entryId);
  clearSubscriptionSecret(entryId);
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, {
    status: 'logged_out',
    usageSummaries: [],
  });
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export function disconnectAISubscription(entryId: AISubscriptionEntryId): AISubscriptionEntry[] {
  advanceAuthGeneration(entryId);
  advanceStatusOperationRevision(entryId);
  if (entryId !== 'minimax-token-plan') activeOAuthLoginDescriptors.delete(entryId);
  clearSubscriptionSecret(entryId);
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, {
    status: 'logged_out',
    usageSummaries: [],
  });
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export async function refreshAISubscriptionStatus(
  entryId: AISubscriptionEntryId,
  deps?: MiniMaxAdapterDeps | { refreshStatus: () => Promise<AISubscriptionConnectionResult> }
): Promise<AISubscriptionEntry[]> {
  if (entryId !== 'minimax-token-plan' && activeOAuthLoginDescriptors.has(entryId)) {
    return getAISubscriptionEntries();
  }
  const generation = currentAuthGeneration(entryId);
  const revision = advanceStatusOperationRevision(entryId);
  let result: AISubscriptionConnectionResult;
  if (entryId === 'minimax-token-plan') {
    const miniMaxDeps = deps && 'httpGetJson' in deps ? deps : defaultMiniMaxAdapterDeps;
    result = await refreshMiniMaxTokenPlan(miniMaxDeps);
  } else {
    const adapter = deps && 'refreshStatus' in deps
      ? deps
      : getDefaultOAuthAdapter(entryId);
    result = await adapter.refreshStatus();
  }
  if (
    !isCurrentStatusOperation(entryId, generation, revision)
    || (entryId !== 'minimax-token-plan' && activeOAuthLoginDescriptors.has(entryId))
  ) {
    return getAISubscriptionEntries();
  }
  const next = setAISubscriptionConnectionResult(readPersistedState(), entryId, result);
  writePersistedState(next);
  return buildAISubscriptionEntries(next);
}

export async function prepareAISubscriptionRuntimeStatus(
  entryId: Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>,
  force = false
): Promise<AISubscriptionEntry[]> {
  if (activeOAuthLoginDescriptors.has(entryId)) return getAISubscriptionEntries();
  const generation = currentAuthGeneration(entryId);
  const revision = advanceStatusOperationRevision(entryId);
  const result = await getDefaultOAuthAdapter(entryId).refreshStatus({ includeUsage: false, force });
  if (
    !isCurrentStatusOperation(entryId, generation, revision)
    || activeOAuthLoginDescriptors.has(entryId)
  ) {
    return getAISubscriptionEntries();
  }
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
