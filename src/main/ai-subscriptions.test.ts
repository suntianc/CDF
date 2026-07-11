import { describe, expect, it } from 'vitest';
import {
  AI_SUBSCRIPTION_ENTRY_IDS,
  buildAISubscriptionEntries,
  buildAISubscriptionTextModelCandidates,
  setAISubscriptionCapabilityEnabled,
  setAISubscriptionConnectionResult,
  selectAISubscriptionCapabilityRoutes,
  type PersistedAISubscriptionState,
} from '../shared/ai-subscriptions';

describe('AI subscription read model', () => {
  it('renders MiniMax, Codex, and xAI Grok entrypoints before login', () => {
    const entries = buildAISubscriptionEntries();

    expect(entries.map((entry) => entry.displayName)).toEqual([
      'MiniMax Token Plan',
      'Codex OAuth',
      'xAI Grok OAuth',
    ]);
    expect(entries.map((entry) => entry.status)).toEqual([
      'logged_out',
      'logged_out',
      'logged_out',
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([
      'minimax-token-plan',
      'codex-oauth',
      'xai-oauth',
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(AI_SUBSCRIPTION_ENTRY_IDS);

    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toMatch(/rawToken|refreshToken|subscriptionKey|endpoint|adapter|routeId|modelId/i);
      expect(entry.capabilities.every((capability) => capability.switchDisabled)).toBe(true);
    }
    expect(entries.find((entry) => entry.id === 'codex-oauth')?.capabilities).toEqual([
      expect.objectContaining({ capabilityId: 'image.generate', enabled: true }),
      expect.objectContaining({ capabilityId: 'image.edit', enabled: true }),
    ]);
    expect(entries.find((entry) => entry.id === 'xai-oauth')?.capabilities).toEqual([
      expect.objectContaining({ capabilityId: 'image.generate', enabled: true }),
      expect.objectContaining({ capabilityId: 'image.edit', enabled: true }),
      expect.objectContaining({ capabilityId: 'video.generate', enabled: true }),
    ]);
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
    expect(minimax?.capabilities.find((capability) => capability.capabilityId === 'music.generate')?.enabled).toBe(true);
    expect(selectAISubscriptionCapabilityRoutes(entries, 'image.generate')).toEqual([]);
    expect(selectAISubscriptionCapabilityRoutes(entries, 'music.generate')).toEqual([
      expect.objectContaining({
        entryId: 'minimax-token-plan',
        capabilityId: 'music.generate',
        sourceType: 'ai_subscription',
      }),
    ]);
    // Always-on: no switches for text.chat / text.reasoning / quota.status
    expect(minimax?.capabilities.some((c) => c.capabilityId === 'text.chat')).toBe(false);
    expect(minimax?.capabilities.some((c) => c.capabilityId === 'text.reasoning')).toBe(false);
    expect(minimax?.capabilities.some((c) => c.capabilityId === 'quota.status')).toBe(false);
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

  it('exposes the Codex OAuth fallback catalog only while the account is connected', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });

    expect(
      buildAISubscriptionTextModelCandidates(connected)
        .filter((candidate) => candidate.sourceId === 'codex-oauth')
    ).toEqual([
      expect.objectContaining({ model: 'gpt-5.6-sol', contextLimit: 372_000 }),
      expect.objectContaining({ model: 'gpt-5.6-terra', contextLimit: 372_000 }),
      expect.objectContaining({ model: 'gpt-5.6-luna', contextLimit: 372_000 }),
      expect.objectContaining({ model: 'gpt-5.5', contextLimit: 272_000 }),
      expect.objectContaining({ model: 'gpt-5.4', contextLimit: 272_000 }),
      expect.objectContaining({ model: 'gpt-5.4-mini', contextLimit: 272_000 }),
      expect.objectContaining({ model: 'gpt-5.3-codex-spark', contextLimit: 128_000 }),
    ]);

    const loggedOut = buildAISubscriptionEntries();
    expect(
      buildAISubscriptionTextModelCandidates(loggedOut)
        .some((candidate) => candidate.sourceId === 'codex-oauth')
    ).toBe(false);
  });

  it('keeps unified chat, reasoning, understanding, code, and quota abilities implicit', () => {
    const entries = buildAISubscriptionEntries({
      entries: {
        'codex-oauth': { status: 'connected' },
        'xai-oauth': { status: 'connected' },
      },
    });

    for (const entryId of ['codex-oauth', 'xai-oauth'] as const) {
      const capabilityIds = entries
        .find((entry) => entry.id === entryId)
        ?.capabilities.map((capability) => capability.capabilityId);
      expect(capabilityIds).not.toContain('text.chat');
      expect(capabilityIds).not.toContain('text.reasoning');
      expect(capabilityIds).not.toContain('code.agent');
      expect(capabilityIds).not.toContain('quota.status');
    }
  });

  it('exposes the current Grok OAuth fallback catalog without retired model slugs', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'xai-oauth': { status: 'connected' } },
    });

    const candidates = buildAISubscriptionTextModelCandidates(connected)
      .filter((candidate) => candidate.sourceId === 'xai-oauth');
    expect(candidates).toEqual([
      expect.objectContaining({ model: 'grok-build-0.1', contextLimit: 256_000 }),
      expect.objectContaining({ model: 'grok-composer-2.5-fast', contextLimit: 200_000 }),
      expect.objectContaining({ model: 'grok-4.5', contextLimit: 500_000 }),
      expect.objectContaining({ model: 'grok-4.3', contextLimit: 1_000_000 }),
      expect.objectContaining({ model: 'grok-4.20-0309-reasoning', contextLimit: 2_000_000 }),
      expect.objectContaining({ model: 'grok-4.20-0309-non-reasoning', contextLimit: 2_000_000 }),
      expect.objectContaining({ model: 'grok-4.20-multi-agent-0309', contextLimit: 2_000_000 }),
    ]);
    expect(candidates.some((candidate) => candidate.model === 'grok-4-fast')).toBe(false);
    expect(candidates.some((candidate) => candidate.model === 'grok-code-fast-1')).toBe(false);
  });

  it('describes the configurable Grok 4.5 reasoning effort through the text model candidate', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'xai-oauth': { status: 'connected' } },
    });

    const candidate = buildAISubscriptionTextModelCandidates(connected)
      .find((item) => item.model === 'grok-4.5');

    expect(candidate?.reasoning).toEqual({
      supportedEfforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      control: 'depth',
    });
  });

  it('allows Grok 4.3 reasoning to be disabled without changing models', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'xai-oauth': { status: 'connected' } },
    });

    const candidate = buildAISubscriptionTextModelCandidates(connected)
      .find((item) => item.model === 'grok-4.3');

    expect(candidate?.reasoning).toEqual({
      supportedEfforts: ['none', 'low', 'medium', 'high'],
      defaultEffort: 'medium',
      control: 'depth',
    });
  });

  it('marks Grok multi-agent effort as an agent-count control', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'xai-oauth': { status: 'connected' } },
    });

    const candidate = buildAISubscriptionTextModelCandidates(connected)
      .find((item) => item.model === 'grok-4.20-multi-agent-0309');

    expect(candidate?.reasoning).toEqual({
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      control: 'agent_count',
    });
  });

  it('exposes each Codex model\'s live reasoning effort range and default', () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const candidates = buildAISubscriptionTextModelCandidates(connected)
      .filter((item) => item.sourceId === 'codex-oauth');
    const profiles = Object.fromEntries(
      candidates.map((candidate) => [candidate.model, candidate.reasoning])
    );

    expect(profiles).toEqual({
      'gpt-5.6-sol': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.6-terra': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.6-luna': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.5': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.4': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.4-mini': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
        control: 'depth',
      },
      'gpt-5.3-codex-spark': {
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'medium',
        control: 'depth',
      },
    });
  });

  it('preserves cached quota when a runtime-only health check omits usage data', () => {
    const persisted: PersistedAISubscriptionState = {
      entries: {
        'codex-oauth': {
          status: 'connected',
          usageSummaries: [{ period: 'five_hour', label: 'Session', used: 35, limit: 100 }],
        },
      },
    };

    const healthOnly = setAISubscriptionConnectionResult(
      persisted,
      'codex-oauth',
      { status: 'connected' }
    );
    const explicitlyCleared = setAISubscriptionConnectionResult(
      healthOnly,
      'codex-oauth',
      { status: 'logged_out', usageSummaries: [] }
    );

    expect(healthOnly.entries?.['codex-oauth']?.usageSummaries).toEqual(
      persisted.entries?.['codex-oauth']?.usageSummaries
    );
    expect(explicitlyCleared.entries?.['codex-oauth']?.usageSummaries).toEqual([]);
  });
});
