import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISubscriptionEntry } from '../shared/ai-subscriptions';

const { getEntriesMock, getSecretMock } = vi.hoisted(() => ({
  getEntriesMock: vi.fn(),
  getSecretMock: vi.fn(),
}));

vi.mock('./ai-subscription-store', () => ({
  getAISubscriptionEntries: getEntriesMock,
}));

vi.mock('./ai-subscription-credentials', () => ({
  getSubscriptionSecret: getSecretMock,
}));

import {
  AISubscriptionRuntimeError,
  MINIMAX_ANTHROPIC_API_BASE_URL,
  resolveAISubscriptionRuntimeModel,
} from './ai-subscription-runtime';

function connectedMiniMax(overrides: Partial<AISubscriptionEntry> = {}): AISubscriptionEntry {
  return {
    id: 'minimax-token-plan',
    displayName: 'MiniMax Token Plan',
    status: 'connected',
    usageSummaries: [],
    capabilities: [
      { capabilityId: 'text.chat', label: 'Text chat', enabled: true, switchDisabled: false, availability: 'available' },
    ],
    ...overrides,
  };
}

describe('resolveAISubscriptionRuntimeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSecretMock.mockReturnValue(undefined);
  });

  it('resolves connected MiniMax Token Plan via Anthropic/Claude-compatible runtime', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.7');

    expect(config).toEqual({
      apiKey: 'sk-minimax-token-plan',
      apiUrl: MINIMAX_ANTHROPIC_API_BASE_URL,
      defaultModel: 'MiniMax-M2.7',
      providerType: 'minimax',
      model: 'MiniMax-M2.7',
      contextLimit: 204_800,
    });
  });

  it('defaults to MiniMax-M3 when none is selected', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', undefined);
    expect(config.model).toBe('MiniMax-M3');
    expect(config.providerType).toBe('minimax');
    expect(config.apiUrl).toBe(MINIMAX_ANTHROPIC_API_BASE_URL);
    expect(config.contextLimit).toBe(1_000_000);
  });

  it('maps legacy M2.5 selections onto the Token Plan M2.7 allowlist', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.5');
    expect(config.model).toBe('MiniMax-M2.7');
    expect(config.providerType).toBe('minimax');
  });

  it('refuses a connected MiniMax card that has no vaulted key', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue(undefined);

    try {
      resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.7');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AISubscriptionRuntimeError);
      const runtimeError = error as AISubscriptionRuntimeError;
      expect(runtimeError.messageKey).toBe('settings.aiSubscriptions.runtimeError.notConnected');
    }
  });

  it('raises a recoverable, localizable error for a disconnected account', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax({ status: 'expired' })]);

    try {
      resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M3');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AISubscriptionRuntimeError);
      const runtimeError = error as AISubscriptionRuntimeError;
      expect(runtimeError.recoverable).toBe(true);
      expect(runtimeError.messageKey).toBe('settings.aiSubscriptions.runtimeError.notConnected');
      expect(runtimeError.messageParams.name).toBe('MiniMax Token Plan');
    }
  });
});
