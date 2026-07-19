import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAISubscriptionEntries, CODEX_OAUTH_TEXT_MODELS, XAI_OAUTH_TEXT_MODELS } from '@shared/ai-subscriptions';
import { ModelSelectionSurface } from './ModelSelectionSurface';
import { buildModelSelectionGroups } from './useModelSelectionController';
import { useLLMStore } from '../../../stores/llmStore';
import { useAISubscriptionStore } from '../../../stores/aiSubscriptionStore';
import type { LLMProvider } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const en: Record<string, string> = {
        'chat.selectModel': 'Select model',
        'chat.modelSelection.label': 'Model',
        'chat.noProvidersAvailable': 'No providers available',
        'chat.modelSelection.sourceKinds.llm_provider': 'API provider',
        'chat.modelSelection.sourceKinds.ai_subscription': 'AI subscription',
        'chat.modelSelection.refreshConfig': 'Refresh config',
        'chat.modelSelection.refreshingConfig': 'Refreshing...',
        'chat.modelSelection.addModel': 'Manage/Add model',
        'chat.reasoningEffort.depthLabel': 'Reasoning depth',
        'chat.reasoningEffort.agentCountLabel': 'Collaboration scale',
        'chat.reasoningEffort.default': 'Default',
        'chat.reasoningEffort.defaultWithEffort': 'Default ({{effort}})',
        'chat.reasoningEffort.efforts.none': 'Off',
        'chat.reasoningEffort.efforts.low': 'Fast',
        'chat.reasoningEffort.efforts.medium': 'Balanced',
        'chat.reasoningEffort.efforts.high': 'Deep',
        'chat.reasoningEffort.efforts.xhigh': 'Very deep',
        'chat.reasoningEffort.efforts.max': 'Maximum',
        'chat.reasoningEffort.efforts.ultra': 'Autonomous',
      };
      const template = en[key] ?? key;
      if (options && typeof template === 'string' && template.includes('{{')) {
        return template.replace(/\{\{(\w+)\}\}/g, (_, name) => options[name] ?? '');
      }
      return template;
    },
    i18n: { language: 'en-US' },
  }),
}));


const originalFetchProviders = useLLMStore.getState().fetchProviders;
const originalFetchEntries = useAISubscriptionStore.getState().fetchEntries;

afterEach(() => {
  useLLMStore.setState({ fetchProviders: originalFetchProviders });
  useAISubscriptionStore.setState({ fetchEntries: originalFetchEntries });
  vi.clearAllMocks();
});
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

    const trigger = screen.getByRole('button', { name: 'gpt-4.1-mini' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    // Open the model submenu
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Anthropic')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'OpenAI • gpt-4.1-mini' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('option', { name: 'Anthropic • claude-sonnet' }));
    expect(onSelectModel).toHaveBeenCalledWith('llm_provider', 'provider-2', 'claude-sonnet');
  });

  it('shows the current provider icon when the default model has no session override', () => {
    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={[]}
        selectedSourceType="llm_provider"
        selectedSourceId=""
        selectedModel=""
        currentModelLabel="MiniMax-M3"
        currentProviderType="minimax"
        onSelectModel={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'MiniMax-M3' })).toBeTruthy();
    expect(screen.getByLabelText('minimax')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax M2.7' }));

    // Open the model submenu
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('MiniMax Token Plan')).toBeTruthy();
    expect(screen.queryByText('API provider')).toBeNull();
    expect(screen.queryByText('AI subscription')).toBeNull();
    expect(screen.getByRole('option', { name: 'MiniMax Token Plan • MiniMax M2.7' })).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/login|quota|switch|endpoint|adapter|route/i);

    fireEvent.click(screen.getByRole('option', { name: 'MiniMax Token Plan • MiniMax M2.7' }));
    expect(onSelectModel).toHaveBeenCalledWith('ai_subscription', 'minimax-token-plan', 'MiniMax-M2.7');
  });

  it('offers an optional inherited Agent selection inside the shared model menu', () => {
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
    ];
    const onSelectInherit = vi.fn();

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={buildModelSelectionGroups(providers)}
        selectedSourceType="llm_provider"
        selectedSourceId=""
        selectedModel=""
        currentModelLabel=""
        onSelectModel={() => {}}
        inheritOption={{
          selected: true,
          label: 'Inherit invoking Agent model',
          onSelect: onSelectInherit,
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inherit invoking Agent model' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    const inheritOption = screen.getByRole('option', { name: 'Inherit invoking Agent model' });
    expect(inheritOption.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'OpenAI • gpt-4.1' })).toBeTruthy();

    fireEvent.click(inheritOption);
    expect(onSelectInherit).toHaveBeenCalledOnce();
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


  it('renders a compact model option with only its icon and mono model name', () => {
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4o-mini' }),
    ];

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={buildModelSelectionGroups(providers)}
        selectedSourceType="llm_provider"
        selectedSourceId="provider-1"
        selectedModel="gpt-4o-mini"
        currentModelLabel="OpenAI • gpt-4o-mini"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4o-mini' }));

    // Open the model submenu
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    const option = screen.getByRole('option', { name: 'OpenAI • gpt-4o-mini' });
    const modelName = within(option).getByText('gpt-4o-mini');
    expect(modelName.className).toContain('font-mono');
    expect(modelName.className).toContain('text-xs');
    expect(option.textContent).toBe('gpt-4o-mini');
    expect(screen.getAllByLabelText('openai')).toHaveLength(2);
    expect(screen.queryByText('API provider')).toBeNull();
  });

  it('triggers configuration and subscription refresh on clicking refresh config button', async () => {
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
    ];
    const fetchProviders = vi.fn(() => Promise.resolve());
    const fetchEntries = vi.fn(() => Promise.resolve());
    useLLMStore.setState({ fetchProviders });
    useAISubscriptionStore.setState({ fetchEntries });

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={buildModelSelectionGroups(providers)}
        selectedSourceType="llm_provider"
        selectedSourceId="provider-1"
        selectedModel="gpt-4.1"
        currentModelLabel="OpenAI • gpt-4.1"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4.1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh config' }));

    await waitFor(() => {
      expect(fetchProviders).toHaveBeenCalledTimes(1);
      expect(fetchEntries).toHaveBeenCalledTimes(1);
    });
  });

  it('triggers settings modal opening on clicking add model button', () => {
    const onOpenSettings = vi.fn();
    const providers = [
      provider({ id: 'provider-1', name: 'OpenAI', default_model: 'gpt-4.1' }),
    ];

    render(
      <ModelSelectionSurface
        variant="composer"
        modelGroups={buildModelSelectionGroups(providers)}
        selectedSourceType="llm_provider"
        selectedSourceId="provider-1"
        selectedModel="gpt-4.1"
        currentModelLabel="OpenAI • gpt-4.1"
        onSelectModel={() => {}}
        onOpenSettings={onOpenSettings}
      />
    );

    const trigger = screen.getByRole('button', { name: 'gpt-4.1' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Manage/Add model' }));

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

    const welcomeTrigger = screen.getByRole('button', { name: 'gpt-4.1' });
    const composerTrigger = screen.getByRole('button', { name: 'claude-sonnet' });
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

  it('renders a reasoning effort row for a Codex model with a reasoning profile', () => {
    const onSelectModel = vi.fn();
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={onSelectModel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // The model dropdown should contain a reasoning effort sub-row for this Codex model
    expect(screen.getByRole('menuitem', { name: /Reasoning depth/ })).toBeTruthy();
  });

  it('does not render a reasoning effort row for a MiniMax model without a reasoning profile', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'minimax-token-plan': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="minimax-token-plan"
        selectedModel="MiniMax-M3"
        currentModelLabel="MiniMax Token Plan • MiniMax M3"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax M3' }));

    // MiniMax text models have no reasoning property — no effort row
    expect(screen.queryByRole('menuitem', { name: /Reasoning depth/ })).toBeNull();
  });

  it('enforces Codex 5.6 reasoning profiles do not include ultra', () => {
    const sol = CODEX_OAUTH_TEXT_MODELS.find((m) => m.model === 'gpt-5.6-sol');
    const terra = CODEX_OAUTH_TEXT_MODELS.find((m) => m.model === 'gpt-5.6-terra');

    for (const model of [sol, terra]) {
      expect(model?.reasoning?.supportedEfforts).toBeDefined();
      expect(model!.reasoning!.supportedEfforts).not.toContain('ultra');
    }
  });

  it('merges the reasoning effort into the trigger accessible name for profiled models but not for no-profile models', () => {
    // Codex has a reasoning profile: trigger must show model + effort (e.g. Fast for default low)
    const codexSub = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const codexGroups = buildModelSelectionGroups([], codexSub);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={codexGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    const codexTrigger = screen.getByRole('button', { name: /GPT-5\.6 Sol/ });
    expect(codexTrigger.getAttribute('aria-label')).toMatch(/GPT-5\.6 Sol.*Balanced/);
    expect(codexTrigger.textContent).toMatch(/GPT-5\.6 Sol.*Balanced/);

    cleanup();

    // MiniMax has no reasoning profile: trigger must show model name only
    const miniMaxSub = buildAISubscriptionEntries({
      entries: { 'minimax-token-plan': { status: 'connected' } },
    });
    const miniMaxGroups = buildModelSelectionGroups([], miniMaxSub);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={miniMaxGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="minimax-token-plan"
        selectedModel="MiniMax-M3"
        currentModelLabel="MiniMax Token Plan • MiniMax M3"
        onSelectModel={() => {}}
      />
    );

    const miniMaxTrigger = screen.getByRole('button', { name: /MiniMax M3/ });
    expect(miniMaxTrigger.getAttribute('aria-label')).toBe('MiniMax M3');
  });

  it('renders reasoning effort sub-menu items as menuitemradio with aria-checked selection semantics', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // This fails in current impl — reasoning effort sub-menu does not exist yet
    const effortTrigger = screen.getByRole('menuitem', { name: /Reasoning depth/ });
    // vvv unreachable until the sub-menu is integrated — specifies expected access semantics
    fireEvent.click(effortTrigger);

    const items = screen.getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThan(1);

    // No "Default" item should be present — all models with profiles default to Balanced (medium)
    const hasDefault = items.some((i) => i.textContent?.startsWith('Default'));
    expect(hasDefault).toBe(false);

    // When selectedEffort is undefined and profile defaultEffort is 'medium', the Balanced item is selected
    const balancedItem = items.find((i) => i.textContent === 'Balanced');
    expect(balancedItem).toBeTruthy();
    expect(balancedItem?.getAttribute('aria-checked')).toBe('true');
  });

  it('renders Balanced radio item as menuitemradio with pl-2 and no visible circle dot', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Reasoning depth/ }));

    const balancedItem = screen.getByRole('menuitemradio', { name: 'Balanced' });
    expect(balancedItem.getAttribute('aria-checked')).toBe('true');
    expect(balancedItem.className).toContain('pl-2');
    expect(balancedItem.className).not.toContain('pl-8');
    expect(balancedItem.querySelector('.lucide-circle')).toBeNull();
  });

  it('renders the model selection sub-menu with project surface and border color tokens', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // Open the "Model" sub-trigger to reveal the model selection sub-content
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model' }));

    // Find the sub-content by its specific width class — w-[240px] is unique to the model sub-content
    const subContent = document.querySelector('.w-\\[240px\\].max-h-\\[320px\\]');
    expect(subContent).toBeTruthy();
    expect(subContent?.className).toContain('bg-[var(--color-bg-surface)]');
    expect(subContent?.className).toContain('border-[var(--color-border-strong)]');
  });

  it('renders the reasoning effort sub-menu with project surface and border color tokens', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // Open the "Reasoning depth" sub-trigger to reveal the reasoning effort sub-content
    fireEvent.click(screen.getByRole('menuitem', { name: /Reasoning depth/ }));

    // Find the sub-content by its specific width class — w-32 is unique to the reasoning sub-content
    const subContent = document.querySelector('.w-32');
    expect(subContent).toBeTruthy();
    expect(subContent?.className).toContain('bg-[var(--color-bg-surface)]');
    expect(subContent?.className).toContain('border-[var(--color-border-strong)]');
  });

  it('requires all profiled models to have medium as their default reasoning effort', () => {
    // Sol currently has 'low', which should be changed to 'medium'
    const sol = CODEX_OAUTH_TEXT_MODELS.find((m) => m.model === 'gpt-5.6-sol');
    expect(sol?.reasoning?.defaultEffort).toBe('medium');

    // Grok 4.5 currently has 'high', which should be changed to 'medium'
    const grok45 = XAI_OAUTH_TEXT_MODELS.find((m) => m.model === 'grok-4.5');
    expect(grok45?.reasoning?.defaultEffort).toBe('medium');

    // Grok 4.3 currently has 'low', which should be changed to 'medium'
    const grok43 = XAI_OAUTH_TEXT_MODELS.find((m) => m.model === 'grok-4.3');
    expect(grok43?.reasoning?.defaultEffort).toBe('medium');

    // Grok multi-agent currently has no defaultEffort, which should be set to 'medium'
    const grokMulti = XAI_OAUTH_TEXT_MODELS.find((m) => m.model === 'grok-4.20-multi-agent-0309');
    expect(grokMulti?.reasoning?.defaultEffort).toBe('medium');

    // Codex Spark currently has 'high', which should be changed to 'medium'
    const spark = CODEX_OAUTH_TEXT_MODELS.find((m) => m.model === 'gpt-5.3-codex-spark');
    expect(spark?.reasoning?.defaultEffort).toBe('medium');
  });

  it('no model candidates rendered directly as top-level options when model has profile', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // Desired: model candidates only inside a submenu, not as top-level role="option"
    // Current: candidates render directly as role="option" in the main menu
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('renders profiled model root menu in order: Model, Reasoning depth, separator, Refresh config, Manage/Add model', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
        onOpenSettings={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    // Verify exact DOM structure of root menu direct children:
    //   1. menuitem "Model"
    //   2. menuitem "Reasoning depth"
    //   3. separator
    //   4. actions div containing exactly 2 buttons: "Refresh config" and "Manage/Add model"
    // This strict structure ensures no extra controls (Speed, Reset, etc.) can appear
    // at the top level without failing the test.
    const menuEl = screen.getByRole('menu');
    const children = Array.from(menuEl.children);

    expect(children).toHaveLength(4);

    expect(children[0].getAttribute('role')).toBe('menuitem');
    expect(children[0].textContent?.trim()).toBe('Model');

    expect(children[1].textContent?.trim()).toMatch(/^Reasoning depth/);

    expect(children[2].getAttribute('role')).toBe('separator');

    const actions = children[3] as HTMLElement;
    const actionChildren = actions.children;
    expect(actionChildren).toHaveLength(2);
    expect(actionChildren[0].getAttribute('role')).toBe('button');
    expect(actionChildren[0].textContent?.trim()).toBe('Refresh config');
    expect(actionChildren[1].getAttribute('role')).toBe('button');
    expect(actionChildren[1].textContent?.trim()).toBe('Manage/Add model');
  });

  it('renders no-profile model root menu in order: Model, separator, Refresh config, Manage/Add model', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'minimax-token-plan': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="minimax-token-plan"
        selectedModel="MiniMax-M3"
        currentModelLabel="MiniMax Token Plan • MiniMax M3"
        onSelectModel={() => {}}
        onOpenSettings={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax M3' }));

    // Verify exact DOM structure of root menu direct children:
    //   1. menuitem "Model" (NO Reasoning depth)
    //   2. separator
    //   3. actions div containing exactly 2 buttons: "Refresh config" and "Manage/Add model"
    // This strict structure ensures no extra controls (Speed, Reset, etc.) can appear
    // at the top level without failing the test.
    const menuEl = screen.getByRole('menu');
    const children = Array.from(menuEl.children);

    expect(children).toHaveLength(3);

    expect(children[0].getAttribute('role')).toBe('menuitem');
    expect(children[0].textContent?.trim()).toBe('Model');
    // No Reasoning depth in the no-profile menu
    expect(children[0].textContent).not.toMatch(/Reasoning/);
    expect(screen.queryByRole('menuitem', { name: /Reasoning depth/ })).toBeNull();

    const actions = children[2] as HTMLElement;
    const actionChildren = actions.children;
    expect(actionChildren).toHaveLength(2);
    expect(actionChildren[0].getAttribute('role')).toBe('button');
    expect(actionChildren[0].textContent?.trim()).toBe('Refresh config');
    expect(actionChildren[1].getAttribute('role')).toBe('button');
    expect(actionChildren[1].textContent?.trim()).toBe('Manage/Add model');
  });

  it('no model candidates rendered directly as top-level options for no-profile model', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'minimax-token-plan': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="minimax-token-plan"
        selectedModel="MiniMax-M3"
        currentModelLabel="MiniMax Token Plan • MiniMax M3"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'MiniMax M3' }));

    // Desired: no candidates directly, no reasoning item
    // Current: candidates render directly as role="option"
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('requires root DropdownMenuContent width to be w-52', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));

    const menuEl = screen.getByRole('menu');
    expect(menuEl.className).toContain('w-52');
    expect(menuEl.className).not.toContain('w-[280px]');
  });

  it('requires reasoning effort sub-menu width to be w-32', () => {
    const subscriptions = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    const modelGroups = buildModelSelectionGroups([], subscriptions);

    render(
      <ModelSelectionSurface
        variant="welcome"
        modelGroups={modelGroups}
        selectedSourceType="ai_subscription"
        selectedSourceId="codex-oauth"
        selectedModel="gpt-5.6-sol"
        currentModelLabel="Codex OAuth • GPT-5.6 Sol"
        onSelectModel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /GPT-5\.6 Sol/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Reasoning depth/ }));

    const reasoningSub = screen.getAllByRole('menu')[1];
    const classTokens = reasoningSub.className.split(/\s+/);
    expect(classTokens).toContain('w-32');
    expect(classTokens).not.toContain('w-[180px]');
  });
});
