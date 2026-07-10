import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '@shared/types';
import { buildAISubscriptionEntries } from '@shared/ai-subscriptions';
import { useModelSelectionController } from './useModelSelectionController';

function provider(overrides: Partial<LLMProvider> & Pick<LLMProvider, 'id' | 'name' | 'default_model'>): LLMProvider {
  return {
    provider_type: 'openai',
    context_limit: 128_000,
    is_active: 1,
    models: [],
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

describe('useModelSelectionController', () => {
  it('uses the active Conversation model override and writes selections to that Conversation', () => {
    const setSessionModelOverride = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1', models: ['gpt-4.1-mini'] }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];

    const { result } = renderHook(() => useModelSelectionController({
      activeSessionId: 'session-1',
      providers,
      aiSubscriptionEntries: [],
      sessionModelOverrides: {
        'session-1': { sourceType: 'llm_provider', sourceId: 'provider-1', providerId: 'provider-1', model: 'gpt-4.1-mini' },
      },
      masterProvider: providers[1],
      setSessionModelOverride,
    }));

    expect(result.current.selectedSourceType).toBe('llm_provider');
    expect(result.current.selectedSourceId).toBe('provider-1');
    expect(result.current.selectedModel).toBe('gpt-4.1-mini');
    expect(result.current.currentProvider?.name).toBe('OpenAI');
    expect(result.current.currentModel).toBe('gpt-4.1-mini');
    expect(result.current.modelGroups.map((group) => group.id)).toEqual([
      'llm_provider:provider-1',
      'llm_provider:provider-2',
    ]);

    act(() => {
      result.current.selectModel('llm_provider', 'provider-2', 'claude-sonnet');
    });

    expect(setSessionModelOverride).toHaveBeenCalledWith('session-1', 'provider-2', 'claude-sonnet', 'llm_provider');
  });

  it('uses the welcome draft model override and writes selections to the welcome target', () => {
    const setSessionModelOverride = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];

    const { result } = renderHook(() => useModelSelectionController({
      activeSessionId: null,
      providers,
      aiSubscriptionEntries: [],
      sessionModelOverrides: {
        '': { sourceType: 'llm_provider', sourceId: 'provider-2', providerId: 'provider-2', model: 'claude-sonnet' },
      },
      masterProvider: providers[0],
      setSessionModelOverride,
    }));

    expect(result.current.selectedSourceId).toBe('provider-2');
    expect(result.current.selectedModel).toBe('claude-sonnet');
    expect(result.current.currentProvider?.name).toBe('Anthropic');

    act(() => {
      result.current.selectModel('llm_provider', 'provider-1', 'gpt-4.1');
    });

    expect(setSessionModelOverride).toHaveBeenCalledWith('', 'provider-1', 'gpt-4.1', 'llm_provider');
  });

  it('groups LLM Provider and connected AI subscription text candidates by concrete source', () => {
    const setSessionModelOverride = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];
    const aiSubscriptionEntries = buildAISubscriptionEntries({
      entries: {
        'minimax-token-plan': { status: 'connected' },
        'codex-oauth': { status: 'connected' },
        'xai-oauth': { status: 'connected' },
      },
    });

    const { result } = renderHook(() => useModelSelectionController({
      activeSessionId: 'session-1',
      providers,
      aiSubscriptionEntries,
      sessionModelOverrides: {
        'session-1': {
          sourceType: 'ai_subscription',
          sourceId: 'minimax-token-plan',
          providerId: 'minimax-token-plan',
          model: 'MiniMax-M2.7',
        },
      },
      masterProvider: providers[0],
      setSessionModelOverride,
    }));

    expect(result.current.modelGroups.map((group) => group.id)).toEqual([
      'llm_provider:provider-1',
      'llm_provider:provider-2',
      'ai_subscription:minimax-token-plan',
      'ai_subscription:codex-oauth',
      'ai_subscription:xai-oauth',
    ]);
    expect(result.current.modelGroups.map((group) => group.sourceName)).toEqual([
      'OpenAI',
      'Anthropic',
      'MiniMax Token Plan',
      'Codex OAuth',
      'xAI Grok OAuth',
    ]);
    expect(result.current.currentModelLabel).toBe('MiniMax Token Plan • MiniMax M2.7');

    act(() => {
      result.current.selectModel('ai_subscription', 'minimax-token-plan', 'MiniMax-M2.7');
    });

    expect(setSessionModelOverride).toHaveBeenCalledWith(
      'session-1',
      'minimax-token-plan',
      'MiniMax-M2.7',
      'ai_subscription'
    );
  });

  it('corrects a stale selected model to the selected provider default', async () => {
    const setSessionModelOverride = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1', models: ['gpt-4.1-mini'] }),
    ];

    renderHook(() => useModelSelectionController({
      activeSessionId: 'session-1',
      providers,
      aiSubscriptionEntries: [],
      sessionModelOverrides: {
        'session-1': { sourceType: 'llm_provider', sourceId: 'provider-1', providerId: 'provider-1', model: 'deleted-model' },
      },
      masterProvider: providers[0],
      setSessionModelOverride,
    }));

    await waitFor(() => {
      expect(setSessionModelOverride).toHaveBeenCalledWith('session-1', 'provider-1', 'gpt-4.1', 'llm_provider');
    });
  });

  it('clears a stale selected provider when providers are available', async () => {
    const setSessionModelOverride = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
    ];

    renderHook(() => useModelSelectionController({
      activeSessionId: 'session-1',
      providers,
      aiSubscriptionEntries: [],
      sessionModelOverrides: {
        'session-1': { sourceType: 'llm_provider', sourceId: 'deleted-provider', providerId: 'deleted-provider', model: 'deleted-model' },
      },
      masterProvider: providers[0],
      setSessionModelOverride,
    }));

    await waitFor(() => {
      expect(setSessionModelOverride).toHaveBeenCalledWith('session-1', '', '', 'llm_provider');
    });
  });
});
