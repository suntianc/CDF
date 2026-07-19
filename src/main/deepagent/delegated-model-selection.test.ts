import { describe, expect, it } from 'vitest';
import { resolveDelegatedModelOverrides } from './delegated-model-selection';

describe('Delegated Agent model selection', () => {
  it('inherits the invoking parent selection when the target has no explicit provider/model', () => {
    const parent = {
      modelSource: 'ai_subscription' as const,
      sourceId: 'codex-account',
      model: 'gpt-5',
      reasoningEffort: 'high' as const,
    };

    expect(resolveDelegatedModelOverrides({
      targetProviderId: null,
      targetConfig: null,
      parentProviderId: 'provider-1',
      parentOverrides: parent,
    })).toEqual(parent);
  });

  it('uses an explicit target provider and model instead of the parent selection', () => {
    expect(resolveDelegatedModelOverrides({
      targetProviderId: 'provider-child',
      targetConfig: { model: 'child-model' },
      parentProviderId: 'provider-parent',
      parentOverrides: {
        modelSource: 'llm_provider',
        sourceId: 'provider-parent',
        model: 'parent-model',
      },
    })).toEqual({
      modelSource: 'llm_provider',
      sourceId: 'provider-child',
      providerId: 'provider-child',
      model: 'child-model',
    });
  });

  it('uses an explicit target AI subscription model instead of treating it as an LLM provider', () => {
    expect(resolveDelegatedModelOverrides({
      targetProviderId: null,
      targetConfig: {
        modelSource: 'ai_subscription',
        sourceId: 'codex-oauth',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      },
      parentProviderId: 'provider-parent',
      parentOverrides: {
        modelSource: 'llm_provider',
        sourceId: 'provider-parent',
        model: 'parent-model',
      },
    })).toEqual({
      modelSource: 'ai_subscription',
      sourceId: 'codex-oauth',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    });
  });
});
