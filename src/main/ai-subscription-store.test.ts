import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAISubscriptionTextModelCandidates } from '../shared/ai-subscriptions';

const { storeGetMock, storeSetMock } = vi.hoisted(() => ({
  storeGetMock: vi.fn(),
  storeSetMock: vi.fn(),
}));

vi.mock('./store', () => ({
  default: {
    get: storeGetMock,
    set: storeSetMock,
  },
}));

vi.mock('./security', () => ({
  encryptApiKey: (value: string) => `encrypted:${value}`,
  decryptApiKey: (value: string) => value.replace(/^encrypted:/, ''),
}));

import {
  cancelAISubscriptionLogin,
  connectAISubscriptionWithKey,
  disconnectAISubscription,
  getActiveAISubscriptionLoginDescriptors,
  getAISubscriptionCapabilityRoutes,
  getAISubscriptionEntries,
  pollAISubscriptionLogin,
  refreshAISubscriptionStatus,
  startAISubscriptionLogin,
} from './ai-subscription-store';

describe('AI subscription main store', () => {
  beforeEach(() => {
    disconnectAISubscription('codex-oauth');
    disconnectAISubscription('xai-oauth');
    vi.clearAllMocks();
    storeGetMock.mockReturnValue({});
  });

  function useStatefulStore(initialState: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      aiSubscriptions: {},
      aiSubscriptionSecrets: {},
      ...initialState,
    };
    storeGetMock.mockImplementation((key: string) => values[key] ?? {});
    storeSetMock.mockImplementation((key: string, value: unknown) => {
      values[key] = value;
    });
    return values;
  }

  it('connects MiniMax with a subscription key without leaking the key into renderer-facing state', async () => {
    const httpGetJson = vi.fn().mockResolvedValue({
      status: 200,
      body: { token_plan: { weekly: { total: 500_000, used: 120_000 }, five_hour: { total: 100_000, used: 8_000 } } },
    });

    const entries = await connectAISubscriptionWithKey('minimax-token-plan', 'sk-secret-key', { httpGetJson });

    const minimax = entries.find((entry) => entry.id === 'minimax-token-plan');
    expect(minimax?.status).toBe('connected');
    expect(minimax?.usageSummaries).toEqual([
      expect.objectContaining({ period: 'weekly', used: 120_000, limit: 500_000 }),
      expect.objectContaining({ period: 'five_hour', used: 8_000, limit: 100_000 }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('sk-secret-key');

    const aiSubscriptionsWrite = storeSetMock.mock.calls.find((call) => call[0] === 'aiSubscriptions');
    expect(JSON.stringify(aiSubscriptionsWrite?.[1])).not.toContain('sk-secret-key');
    expect(buildAISubscriptionTextModelCandidates(entries)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'ai_subscription',
        sourceId: 'minimax-token-plan',
        model: 'MiniMax-M2.7',
      }),
    ]));
  });

  it('starts Codex login by persisting connecting state and returning only a safe descriptor', async () => {
    const descriptor = {
      attemptId: 'attempt-1',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    const adapter = {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    };

    const result = await startAISubscriptionLogin('codex-oauth', adapter);

    expect(result.descriptor).toEqual(descriptor);
    expect(result.entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connecting');
    expect(JSON.stringify(result)).not.toMatch(/device_auth_id|access.?token|refresh.?token|code.?verifier/i);
    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptions', expect.objectContaining({
      entries: expect.objectContaining({
        'codex-oauth': expect.objectContaining({ status: 'connecting' }),
      }),
    }));
    expect(getActiveAISubscriptionLoginDescriptors()).toEqual({
      'codex-oauth': descriptor,
    });
    disconnectAISubscription('codex-oauth');
  });

  it('heals a persisted connecting state when no in-memory device attempt survived restart', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return { entries: { 'codex-oauth': { status: 'connecting' } } };
      }
      if (key === 'aiSubscriptionSecrets') return {};
      return {};
    });

    const entries = getAISubscriptionEntries();

    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('logged_out');
  });

  it('writes Codex login completion back to the subscription card', async () => {
    useStatefulStore();
    const descriptor = {
      attemptId: 'attempt-1',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    });
    const adapter = {
      pollLoginStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
    };

    const result = await pollAISubscriptionLogin('codex-oauth', 'attempt-1', adapter);

    expect(result.status).toBe('connected');
    expect(result.entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connected');
    expect(JSON.stringify(result)).not.toMatch(/access.?token|refresh.?token|code.?verifier/i);
    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptions', expect.objectContaining({
      entries: expect.objectContaining({
        'codex-oauth': expect.objectContaining({ status: 'connected' }),
      }),
    }));
  });

  it('single-flights concurrent polls for the same login attempt across renderer reloads', async () => {
    useStatefulStore();
    const descriptor = {
      attemptId: 'attempt-shared',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    });
    let resolvePoll!: (value: { status: 'connected' }) => void;
    const pollResult = new Promise<{ status: 'connected' }>((resolve) => {
      resolvePoll = resolve;
    });
    const pollLoginStatus = vi.fn().mockReturnValue(pollResult);

    const first = pollAISubscriptionLogin('codex-oauth', descriptor.attemptId, { pollLoginStatus });
    const second = pollAISubscriptionLogin('codex-oauth', descriptor.attemptId, { pollLoginStatus });
    resolvePoll({ status: 'connected' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'connected' }),
      expect.objectContaining({ status: 'connected' }),
    ]);
    expect(pollLoginStatus).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale login poll after a newer device attempt supersedes it', async () => {
    useStatefulStore();
    const descriptorA = {
      attemptId: 'attempt-a',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AAAA-BBBB',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    const descriptorB = { ...descriptorA, attemptId: 'attempt-b', userCode: 'CCCC-DDDD' };

    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorA }),
    });
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorB }),
    });

    const result = await pollAISubscriptionLogin('codex-oauth', 'attempt-a', {
      pollLoginStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
    });

    expect(result.status).toBe('connecting');
    expect(result.entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connecting');
    expect(getActiveAISubscriptionLoginDescriptors()['codex-oauth']).toEqual(descriptorB);
  });

  it('cancels the previous provider session when a newer device login supersedes it', async () => {
    useStatefulStore();
    const descriptorA = {
      attemptId: 'attempt-a',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AAAA-BBBB',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    const descriptorB = { ...descriptorA, attemptId: 'attempt-b', userCode: 'CCCC-DDDD' };
    const cancelLogin = vi.fn().mockResolvedValue(undefined);

    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorA }),
      cancelLogin,
    });
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorB }),
      cancelLogin,
    });

    expect(cancelLogin).toHaveBeenCalledWith('attempt-a');
    expect(getActiveAISubscriptionLoginDescriptors()['codex-oauth']).toEqual(descriptorB);
  });

  it('does not let cancellation of a stale login clear a newer account attempt or credential', async () => {
    const values = useStatefulStore();
    const descriptorA = {
      attemptId: 'attempt-a',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AAAA-BBBB',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    const descriptorB = { ...descriptorA, attemptId: 'attempt-b', userCode: 'CCCC-DDDD' };

    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorA }),
    });
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor: descriptorB }),
    });
    const credential = {
      kind: 'oauth',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      obtainedAt: 1_800_000_000_000,
    };
    values.aiSubscriptionSecrets = {
      'codex-oauth': `safe-storage:v1:encrypted:${JSON.stringify(credential)}`,
    };

    const cancelLogin = vi.fn().mockResolvedValue(undefined);
    const entries = await cancelAISubscriptionLogin('codex-oauth', 'attempt-a', { cancelLogin });

    expect(cancelLogin).toHaveBeenCalledWith('attempt-a');
    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connecting');
    expect(JSON.stringify(values.aiSubscriptionSecrets)).toContain('new-access-token');
    expect(getActiveAISubscriptionLoginDescriptors()['codex-oauth']).toEqual(descriptorB);
  });

  it('does not let an older status refresh overwrite a newer login generation', async () => {
    useStatefulStore({
      aiSubscriptions: { entries: { 'codex-oauth': { status: 'connected' } } },
      aiSubscriptionSecrets: {
        'codex-oauth': `safe-storage:v1:encrypted:${JSON.stringify({
          kind: 'oauth',
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          obtainedAt: 1_800_000_000_000,
        })}`,
      },
    });
    let resolveRefresh!: (value: { status: 'logged_out' }) => void;
    const refreshStatus = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const refreshPromise = refreshAISubscriptionStatus('codex-oauth', { refreshStatus });
    const descriptor = {
      attemptId: 'attempt-new',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'EEEE-FFFF',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };

    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    });
    resolveRefresh({ status: 'logged_out' });
    const entries = await refreshPromise;

    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connecting');
    expect(getActiveAISubscriptionLoginDescriptors()['codex-oauth']).toEqual(descriptor);
  });

  it('does not let a background refresh supersede a device login that is still starting', async () => {
    useStatefulStore({
      aiSubscriptions: { entries: { 'codex-oauth': { status: 'connected' } } },
      aiSubscriptionSecrets: {
        'codex-oauth': `safe-storage:v1:encrypted:${JSON.stringify({
          kind: 'oauth',
          accessToken: 'existing-access-token',
          refreshToken: 'existing-refresh-token',
          obtainedAt: 1_800_000_000_000,
        })}`,
      },
    });
    const descriptor = {
      attemptId: 'attempt-new',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'EEEE-FFFF',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    let resolveStart!: (value: { status: 'connecting'; descriptor: typeof descriptor }) => void;
    const startPromise = startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockReturnValue(new Promise((resolve) => {
        resolveStart = resolve;
      })),
    });

    await refreshAISubscriptionStatus('codex-oauth', {
      refreshStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
    });
    resolveStart({ status: 'connecting', descriptor });

    await expect(startPromise).resolves.toEqual(expect.objectContaining({ descriptor }));
    expect(getActiveAISubscriptionLoginDescriptors()['codex-oauth']).toEqual(descriptor);
  });

  it('does not refresh account health while an OAuth device login is active', async () => {
    useStatefulStore();
    const descriptor = {
      attemptId: 'attempt-active',
      flow: 'device_code' as const,
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'AAAA-BBBB',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    await startAISubscriptionLogin('codex-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    });
    const refreshStatus = vi.fn().mockResolvedValue({ status: 'logged_out' });

    const entries = await refreshAISubscriptionStatus('codex-oauth', { refreshStatus });

    expect(refreshStatus).not.toHaveBeenCalled();
    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connecting');
  });

  it('retains the subscription key in the credential vault so refresh can reuse it', async () => {
    const httpGetJson = vi.fn().mockResolvedValue({ status: 200, body: {} });

    await connectAISubscriptionWithKey('minimax-token-plan', 'sk-secret-key', { httpGetJson });

    const secretWrite = storeSetMock.mock.calls.find((call) => call[0] === 'aiSubscriptionSecrets');
    expect(secretWrite).toBeDefined();
    expect(JSON.stringify(secretWrite?.[1])).toContain('sk-secret-key');
  });

  it('treats a persisted connected account with no vaulted credential as logged out', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return { entries: { 'minimax-token-plan': { status: 'connected' } } };
      }
      return {};
    });

    const entries = getAISubscriptionEntries();
    expect(entries.find((entry) => entry.id === 'minimax-token-plan')?.status).toBe('logged_out');
  });

  it('keeps a terminal OAuth credential quarantined across process restart', () => {
    const terminalCredential = {
      kind: 'oauth',
      accessToken: 'rejected-access-token',
      refreshToken: 'rejected-refresh-token',
      obtainedAt: 1_800_000_000_000,
      expiresAt: 1_800_003_600_000,
      terminalStatus: 'expired',
    };
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return { entries: { 'codex-oauth': { status: 'connected' } } };
      }
      if (key === 'aiSubscriptionSecrets') {
        return {
          'codex-oauth': `safe-storage:v1:encrypted:${JSON.stringify(terminalCredential)}`,
        };
      }
      return {};
    });

    const entries = getAISubscriptionEntries();

    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('expired');
    expect(buildAISubscriptionTextModelCandidates(entries)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'codex-oauth' })])
    );
  });

  it('keeps xAI entitlement denial unavailable across restart and clears it only on reconnect', async () => {
    const values = useStatefulStore({
      aiSubscriptions: { entries: { 'xai-oauth': { status: 'connected' } } },
      aiSubscriptionSecrets: {
        'xai-oauth': `safe-storage:v1:encrypted:${JSON.stringify({
          kind: 'oauth',
          accessToken: 'valid-but-unentitled-access-token',
          refreshToken: 'refresh-token',
          obtainedAt: 1_800_000_000_000,
          terminalStatus: 'unavailable',
          terminalReason: 'xai_entitlement_denied',
        })}`,
      },
    });

    expect(getAISubscriptionEntries().find((entry) => entry.id === 'xai-oauth')?.status).toBe('unavailable');

    const descriptor = {
      attemptId: 'xai-reconnect',
      flow: 'device_code' as const,
      verificationUrl: 'https://x.ai/device',
      userCode: 'GROK-CODE',
      expiresAt: 1_800_000_900_000,
      pollIntervalMs: 5_000,
    };
    const result = await startAISubscriptionLogin('xai-oauth', {
      startLogin: vi.fn().mockResolvedValue({ status: 'connecting', descriptor }),
    });

    expect(result.entries.find((entry) => entry.id === 'xai-oauth')?.status).toBe('connecting');
    expect(values.aiSubscriptionSecrets).toEqual({});
  });

  it('keeps supported OAuth entrypoints visible while dropping removed providers', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return {
          entries: {
            'minimax-token-plan': { status: 'logged_out' },
            'codex-oauth': { status: 'connected' },
            'xai-oauth': { status: 'connected' },
            'antigravity-oauth': { status: 'connected' },
          },
        };
      }
      return {};
    });

    const entries = getAISubscriptionEntries();
    expect(entries.map((entry) => entry.id)).toEqual([
      'minimax-token-plan',
      'codex-oauth',
      'xai-oauth',
    ]);
    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('logged_out');
    expect(entries.find((entry) => entry.id === 'xai-oauth')?.status).toBe('logged_out');
  });

  it('excludes a disabled account route from the capability read path', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return {
          entries: {
            'minimax-token-plan': { status: 'connected', capabilities: { 'image.generate': false } },
          },
        };
      }
      if (key === 'aiSubscriptionSecrets') return { 'minimax-token-plan': 'sk' };
      return {};
    });

    const routeIds = getAISubscriptionCapabilityRoutes('image.generate').map((route) => route.entryId);
    expect(routeIds).not.toContain('minimax-token-plan');
    expect(getAISubscriptionCapabilityRoutes('music.generate').map((r) => r.entryId)).toContain('minimax-token-plan');
  });

  it('disconnects a subscription, clearing its vault secret and resetting status to logged out', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptionSecrets') return { 'minimax-token-plan': 'sk-secret' };
      if (key === 'aiSubscriptions') return { entries: { 'minimax-token-plan': { status: 'connected' } } };
      return {};
    });

    const entries = disconnectAISubscription('minimax-token-plan');

    expect(entries.find((entry) => entry.id === 'minimax-token-plan')?.status).toBe('logged_out');
    const secretWrite = storeSetMock.mock.calls.find((call) => call[0] === 'aiSubscriptionSecrets');
    expect(secretWrite).toBeDefined();
    expect(JSON.stringify(secretWrite?.[1])).not.toContain('sk-secret');
  });

  it('refreshes MiniMax quota by reusing the stored vault key', async () => {
    storeGetMock.mockImplementation((key: string) =>
      key === 'aiSubscriptionSecrets' ? { 'minimax-token-plan': 'sk-stored-key' } : {}
    );
    const httpGetJson = vi.fn().mockResolvedValue({
      status: 200,
      body: { token_plan: { weekly: { total: 500_000, used: 200_000 } } },
    });

    const entries = await refreshAISubscriptionStatus('minimax-token-plan', { httpGetJson });

    expect(httpGetJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ Authorization: 'Bearer sk-stored-key' })
    );
    const minimax = entries.find((entry) => entry.id === 'minimax-token-plan');
    expect(minimax?.status).toBe('connected');
    expect(minimax?.usageSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: 'weekly', used: 200_000, remaining: 300_000 }),
    ]));
  });

  it('refreshes Codex status through its account adapter', async () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return { entries: { 'codex-oauth': { status: 'expired' } } };
      }
      return {};
    });
    const adapter = {
      refreshStatus: vi.fn().mockResolvedValue({ status: 'connected' }),
    };

    const entries = await refreshAISubscriptionStatus('codex-oauth', adapter);

    expect(adapter.refreshStatus).toHaveBeenCalledTimes(1);
    expect(entries.find((entry) => entry.id === 'codex-oauth')?.status).toBe('connected');
  });
});
