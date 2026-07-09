import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '@shared/types';
import { buildAISubscriptionEntries } from '@shared/ai-subscriptions';
import { ModelSelectionSurface } from './ModelSelectionSurface';
import { buildModelSelectionGroups } from './useModelSelectionController';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.selectModel': 'Select model',
      'chat.noProvidersAvailable': 'No providers available',
      'chat.modelSelection.sourceKinds.llm_provider': 'API provider',
      'chat.modelSelection.sourceKinds.ai_subscription': 'AI subscription',
    }[key] ?? key),
  }),
}));

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

describe('ModelSelectionSurface', () => {
  it('renders provider model candidates and delegates model selection', () => {
    const onSelectModel = vi.fn();
    const providers = [
      provider({
        id: 'provider-1',
        name: 'OpenAI',
        default_model: 'gpt-4.1',
        models: ['gpt-4.1-mini', 'gpt-4.1-mini'],
      }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={buildModelSelectionGroups(providers)}
        selectedSourceType="llm_provider"
        selectedSourceId="provider-1"
        selectedModel="gpt-4.1-mini"
        currentModelLabel="OpenAI • gpt-4.1-mini"
        onSelectModel={onSelectModel}
      />
    );

    const trigger = screen.getByRole('button', { name: 'OpenAI • gpt-4.1-mini' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'OpenAI • gpt-4.1-mini' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('option', { name: 'Anthropic • claude-sonnet' }));
    expect(onSelectModel).toHaveBeenCalledWith('llm_provider', 'provider-2', 'claude-sonnet');
  });

  it('renders AI subscription text candidates as a separate source group without account-management controls', () => {
    const onSelectModel = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
    ];
    const subscriptions = buildAISubscriptionEntries({
      entries: {
        'minimax-token-plan': { status: 'connected' },
      },
    });

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={buildModelSelectionGroups(providers, subscriptions)}
        selectedSourceType="ai_subscription"
        selectedSourceId="minimax-token-plan"
        selectedModel="MiniMax-M2.7"
        currentModelLabel="MiniMax Token Plan • MiniMax M2.7"
        onSelectModel={onSelectModel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax Token Plan • MiniMax M2.7' }));

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('MiniMax Token Plan')).toBeTruthy();
    expect(screen.getByText('API provider')).toBeTruthy();
    expect(screen.getByText('AI subscription')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'MiniMax Token Plan • MiniMax M2.7' })).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/login|quota|switch|endpoint|adapter|route/i);

    fireEvent.click(screen.getByRole('option', { name: 'MiniMax Token Plan • MiniMax M2.7' }));
    expect(onSelectModel).toHaveBeenCalledWith('ai_subscription', 'minimax-token-plan', 'MiniMax-M2.7');
  });

  it('offers settings when no providers are available', () => {
    const onOpenSettings = vi.fn();

    render(
      <ModelSelectionSurface
        variant="composer"
        modelGroups={[]}
        selectedSourceType="llm_provider"
        selectedSourceId=""
        selectedModel=""
        currentModelLabel=""
        onSelectModel={() => {}}
        onOpenSettings={onOpenSettings}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Select model' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'No providers available' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps dropdown open state local to each Model Selection Surface', () => {
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];

    render(
      <>
        <ModelSelectionSurface
          variant="welcome"
          modelGroups={buildModelSelectionGroups(providers)}
          selectedSourceType="llm_provider"
          selectedSourceId="provider-1"
          selectedModel="gpt-4.1"
          currentModelLabel="OpenAI • gpt-4.1"
          onSelectModel={() => {}}
        />
        <ModelSelectionSurface
          variant="composer"
          modelGroups={buildModelSelectionGroups(providers)}
          selectedSourceType="llm_provider"
          selectedSourceId="provider-2"
          selectedModel="claude-sonnet"
          currentModelLabel="Anthropic • claude-sonnet"
          onSelectModel={() => {}}
        />
      </>
    );

    const welcomeTrigger = screen.getByRole('button', { name: 'OpenAI • gpt-4.1' });
    const composerTrigger = screen.getByRole('button', { name: 'Anthropic • claude-sonnet' });
    fireEvent.click(welcomeTrigger);
    expect(welcomeTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(composerTrigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(composerTrigger);
    expect(welcomeTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(composerTrigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseDown(document.body);
    expect(welcomeTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(composerTrigger.getAttribute('aria-expanded')).toBe('false');
  });
});
