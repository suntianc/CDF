import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '@shared/types';
import { ModelSelectionSurface } from './ModelSelectionSurface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.selectModel': 'Select model',
      'chat.noProvidersAvailable': 'No providers available',
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
        providers={providers}
        selectedProviderId="provider-1"
        selectedModel="gpt-4.1-mini"
        currentProvider={providers[0]}
        currentModel="gpt-4.1-mini"
        onSelectModel={onSelectModel}
      />
    );

    expect(screen.getByText('OpenAI • gpt-4.1-mini')).toBeTruthy();

    fireEvent.click(screen.getByText('OpenAI • gpt-4.1-mini'));

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getAllByText('gpt-4.1-mini')).toHaveLength(1);

    fireEvent.click(screen.getByTitle('Anthropic • claude-sonnet'));
    expect(onSelectModel).toHaveBeenCalledWith('provider-2', 'claude-sonnet');
  });

  it('offers settings when no providers are available', () => {
    const onOpenSettings = vi.fn();

    const { container } = render(
      <ModelSelectionSurface
        variant="composer"
        providers={[]}
        selectedProviderId=""
        selectedModel=""
        currentProvider={null}
        currentModel=""
        onSelectModel={() => {}}
        onOpenSettings={onOpenSettings}
      />
    );

    fireEvent.click(screen.getByText('Select model'));
    expect(container.querySelector('.model-selector')?.className).toContain('open');

    fireEvent.click(screen.getByText('No providers available'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.model-selector')?.className).not.toContain('open');
  });

  it('keeps dropdown open state local to each Model Selection Surface', () => {
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
      provider({ id: 'provider-2', name: 'Anthropic', default_model: 'claude-sonnet' }),
    ];

    const { container } = render(
      <>
        <ModelSelectionSurface
          variant="welcome"
          providers={providers}
          selectedProviderId="provider-1"
          selectedModel="gpt-4.1"
          currentProvider={providers[0]}
          currentModel="gpt-4.1"
          onSelectModel={() => {}}
        />
        <ModelSelectionSurface
          variant="composer"
          providers={providers}
          selectedProviderId="provider-2"
          selectedModel="claude-sonnet"
          currentProvider={providers[1]}
          currentModel="claude-sonnet"
          onSelectModel={() => {}}
        />
      </>
    );

    const selectors = container.querySelectorAll('.model-selector');
    fireEvent.click(screen.getByText('OpenAI • gpt-4.1'));
    expect(selectors[0].className).toContain('open');
    expect(selectors[1].className).not.toContain('open');

    fireEvent.click(screen.getByText('Anthropic • claude-sonnet'));
    expect(selectors[0].className).toContain('open');
    expect(selectors[1].className).toContain('open');

    fireEvent.mouseDown(document.body);
    expect(selectors[0].className).not.toContain('open');
    expect(selectors[1].className).not.toContain('open');
  });
});
