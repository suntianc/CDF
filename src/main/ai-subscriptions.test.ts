import { describe, expect, it } from 'vitest';
import {
  AI_SUBSCRIPTION_ENTRY_IDS,
  buildAISubscriptionEntries,
  buildAISubscriptionTextModelCandidates,
  setAISubscriptionCapabilityEnabled,
  selectAISubscriptionCapabilityRoutes,
  type PersistedAISubscriptionState,
} from '../shared/ai-subscriptions';

describe('AI subscription read model', () => {
  it('renders MiniMax Token Plan as the only first-version entrypoint', () => {
    const entries = buildAISubscriptionEntries();

    expect(entries.map((entry) => entry.displayName)).toEqual([
      'MiniMax Token Plan',
    ]);
    expect(entries.map((entry) => entry.status)).toEqual([
      'logged_out',
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(AI_SUBSCRIPTION_ENTRY_IDS);

    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toMatch(/rawToken|refreshToken|subscriptionKey|endpoint|adapter|routeId|modelId/i);
      expect(entry.capabilities.length).toBeGreaterThan(0);
      expect(entry.capabilities.every((capability) => capability.switchDisabled)).toBe(true);
    }
  });

  it('persists one disabled capability without mutating sibling capability routes', () => {
    const connected: PersistedAISubscriptionState = {
      entries: {
        'minimax-token-plan': {
          status: 'connected',
        },
      },
    };
    const next = setAISubscriptionCapabilityEnabled(
      connected,
      'minimax-token-plan',
      'image.generate',
      false
    );
    const entries = buildAISubscriptionEntries(next);
    const minimax = entries.find((entry) => entry.id === 'minimax-token-plan');

    expect(minimax?.capabilities.find((capability) => capability.capabilityId === 'image.generate')?.enabled).toBe(false);
    expect(minimax?.capabilities.find((capability) => capability.capabilityId === 'text.chat')?.enabled).toBe(true);
    expect(selectAISubscriptionCapabilityRoutes(entries, 'image.generate')).toEqual([]);
    expect(selectAISubscriptionCapabilityRoutes(entries, 'text.chat')).toEqual([
      expect.objectContaining({
        entryId: 'minimax-token-plan',
        capabilityId: 'text.chat',
        sourceType: 'ai_subscription',
      }),
    ]);
  });

  it('exposes text model candidates only for connected text-capable MiniMax', () => {
    const entries = buildAISubscriptionEntries({
      entries: {
        'minimax-token-plan': { status: 'connected' },
      },
    });

    const candidates = buildAISubscriptionTextModelCandidates(entries);
    expect(candidates.every((candidate) => candidate.sourceId === 'minimax-token-plan')).toBe(true);
    expect(candidates.map((candidate) => candidate.model).sort()).toEqual([
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M3',
    ]);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'ai_subscription',
        sourceId: 'minimax-token-plan',
        sourceName: 'MiniMax Token Plan',
        model: 'MiniMax-M2.7',
        label: 'MiniMax M2.7',
        contextLimit: 204_800,
      }),
      expect.objectContaining({
        model: 'MiniMax-M3',
        contextLimit: 1_000_000,
      }),
    ]));
    expect(candidates.some((c) => c.model.includes('M2.5'))).toBe(false);
    // web_search is not a Token Plan capability in CDF
    const entry = entries.find((e) => e.id === 'minimax-token-plan');
    expect(entry?.capabilities.some((c) => c.capabilityId === 'search.web')).toBe(false);
  });
});
