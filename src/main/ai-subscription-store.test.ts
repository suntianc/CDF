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

import {
  connectAISubscriptionWithKey,
  disconnectAISubscription,
  getAISubscriptionCapabilityRoutes,
  getAISubscriptionEntries,
  refreshAISubscriptionStatus,
} from './ai-subscription-store';

describe('AI subscription main store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockReturnValue({});
  });

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

  it('drops removed OAuth entry ids from the persisted read model', () => {
    storeGetMock.mockImplementation((key: string) => {
      if (key === 'aiSubscriptions') {
        return {
          entries: {
            'minimax-token-plan': { status: 'logged_out' },
            'codex-oauth': { status: 'connected' },
            'xai-oauth': { status: 'connected' },
          },
        };
      }
      return {};
    });

    const entries = getAISubscriptionEntries();
    expect(entries.map((entry) => entry.id)).toEqual(['minimax-token-plan']);
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
});
