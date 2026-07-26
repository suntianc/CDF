import { describe, expect, it } from 'vitest';
import type { ModelSelectionGroup } from '../ChatArea/modelSelection/useModelSelectionController';
import {
  agentFormReducer,
  buildAgentSavePayload,
  createEmptyAgentFormState,
  deriveAgentFormState,
  findDefaultModelGroup,
  getAgentFormValidationError,
  type AgentFormState,
} from './agentEditForm';

const provider = (id: string, isActive: 0 | 1) => ({
  id, name: id, provider_type: 'ollama', default_model: 'llama3',
  context_limit: 8192, is_active: isActive, created_at: 0, updated_at: 0,
}) as any;

const group = (
  sourceType: 'llm_provider' | 'ai_subscription',
  sourceId: string,
  models: string[],
  reasoning?: { supportedEfforts: string[] },
): ModelSelectionGroup => ({
  id: `${sourceType}:${sourceId}`,
  sourceType,
  sourceId,
  sourceName: sourceId,
  candidates: models.map((model) => ({
    key: `${sourceId}:${model}`,
    sourceType,
    sourceId,
    sourceName: sourceId,
    model,
    label: model,
    ...(reasoning ? { reasoning: reasoning as any } : {}),
  })),
});

const agentBase = {
  id: 'agent-1', role: 'custom' as const, name: 'Review Agent',
  created_at: 0, updated_at: 0,
};

describe('agentFormReducer', () => {
  it('selectModel replaces the selection and clears the reasoning effort', () => {
    const state: AgentFormState = {
      ...createEmptyAgentFormState(),
      modelSource: 'llm_provider', sourceId: 'p1', model: 'm1', reasoningEffort: 'high',
    };

    const next = agentFormReducer(state, {
      type: 'selectModel', sourceType: 'ai_subscription', sourceId: 'sub-1', model: 'm2',
    });

    expect(next).toMatchObject({
      modelSource: 'ai_subscription', sourceId: 'sub-1', model: 'm2', reasoningEffort: undefined,
    });
  });

  it('toggleListItem adds then removes an id without mutating the previous state', () => {
    const state = createEmptyAgentFormState();

    const added = agentFormReducer(state, { type: 'toggleListItem', field: 'builtInTools', id: 'grep' });
    expect(added.builtInTools).toEqual(['grep']);
    expect(state.builtInTools).toEqual([]);

    const removed = agentFormReducer(added, { type: 'toggleListItem', field: 'builtInTools', id: 'grep' });
    expect(removed.builtInTools).toEqual([]);
  });

  it('patch merges partial fields and reset replaces the whole state', () => {
    const patched = agentFormReducer(createEmptyAgentFormState(), {
      type: 'patch', patch: { name: 'A', systemPrompt: 'P' },
    });
    expect(patched).toMatchObject({ name: 'A', systemPrompt: 'P', description: '' });

    const target = { ...createEmptyAgentFormState(), name: 'B' };
    expect(agentFormReducer(patched, { type: 'reset', state: target })).toBe(target);
  });
});

describe('findDefaultModelGroup', () => {
  it('prefers the active provider group and falls back to the first group', () => {
    const groups = [group('ai_subscription', 'sub-1', ['m']), group('llm_provider', 'p2', ['llama3'])];

    expect(findDefaultModelGroup(groups, [provider('p2', 1)])?.sourceId).toBe('p2');
    expect(findDefaultModelGroup(groups, [provider('p2', 0)])?.sourceId).toBe('sub-1');
    expect(findDefaultModelGroup([], [provider('p2', 1)])).toBeUndefined();
  });
});

describe('deriveAgentFormState', () => {
  it('hydrates every capability field from a persisted agent', () => {
    const state = deriveAgentFormState({
      agent: {
        ...agentBase,
        description: 'Reviews PRs',
        provider_id: 'p1',
        system_prompt: 'Review carefully',
        mcpServerExclusionIds: ['mcp-a'],
        skillNames: ['global:review'],
        config: {
          modelSource: 'llm_provider', sourceId: 'p1', model: 'llama3',
          toolScope: { mode: 'narrow', builtInTools: ['grep'], mcpServerIds: ['mcp-a'] },
        },
      },
      modelGroups: [group('llm_provider', 'p1', ['llama3'])],
      providers: [provider('p1', 1)],
      providersLoading: false,
      aiSubscriptionsLoading: false,
    });

    expect(state).toEqual({
      name: 'Review Agent',
      description: 'Reviews PRs',
      modelSource: 'llm_provider',
      sourceId: 'p1',
      model: 'llama3',
      reasoningEffort: undefined,
      systemPrompt: 'Review carefully',
      mcpExclusionIds: ['mcp-a'],
      skillIds: ['global:review'],
      toolScopeMode: 'narrow',
      builtInTools: ['grep'],
      toolScopeMcpServerIds: ['mcp-a'],
    });
  });

  it('keeps a persisted reasoning effort only when the selected candidate supports it', () => {
    const derive = (models: string[], reasoning?: { supportedEfforts: string[] }) => deriveAgentFormState({
      agent: {
        ...agentBase,
        config: { modelSource: 'ai_subscription', sourceId: 'sub-1', model: 'm1', reasoningEffort: 'high' },
      },
      modelGroups: [group('ai_subscription', 'sub-1', models, reasoning)],
      providers: [],
      providersLoading: false,
      aiSubscriptionsLoading: false,
    });

    expect(derive(['m1'], { supportedEfforts: ['low', 'high'] }).reasoningEffort).toBe('high');
    expect(derive(['m1'], { supportedEfforts: ['low'] }).reasoningEffort).toBeUndefined();
    // Unknown candidate: nothing proves the effort invalid, so it is preserved.
    expect(derive(['other-model']).reasoningEffort).toBe('high');
  });

  it('falls back to the default group for a Custom Agent without configured model', () => {
    const state = deriveAgentFormState({
      agent: agentBase,
      modelGroups: [group('llm_provider', 'p1', ['llama3', 'llama2'])],
      providers: [provider('p1', 1)],
      providersLoading: false,
      aiSubscriptionsLoading: false,
    });

    expect(state).toMatchObject({ modelSource: 'llm_provider', sourceId: 'p1', model: 'llama3' });
  });

  it('seeds a fresh form with the default group, or empty while sources load', () => {
    const groups = [group('llm_provider', 'p1', ['llama3'])];
    const loaded = deriveAgentFormState({
      modelGroups: groups, providers: [provider('p1', 1)],
      providersLoading: false, aiSubscriptionsLoading: false,
    });
    expect(loaded).toMatchObject({ modelSource: 'llm_provider', sourceId: 'p1', model: 'llama3', name: '' });

    const loading = deriveAgentFormState({
      modelGroups: groups, providers: [provider('p1', 1)],
      providersLoading: true, aiSubscriptionsLoading: false,
    });
    expect(loading).toMatchObject({ modelSource: '', sourceId: '', model: '' });
  });
});

describe('getAgentFormValidationError', () => {
  it('walks blank name, non-English name, then missing source', () => {
    const base = createEmptyAgentFormState();
    expect(getAgentFormValidationError({ ...base, name: '   ' }, false)).toBe('agent.nameRequired');
    expect(getAgentFormValidationError({ ...base, name: '评审' }, false)).toBe('agent.nameEnglishOnly');
    expect(getAgentFormValidationError({ ...base, name: 'Agent-1' }, false)).toBe('agent.providerRequired');
    expect(getAgentFormValidationError({ ...base, name: 'Agent-1' }, true)).toBe(null);
    expect(getAgentFormValidationError({ ...base, name: 'Agent-1', sourceId: 'p1' }, false)).toBe(null);
  });
});

describe('buildAgentSavePayload', () => {
  it('serializes model selection, tool scope and capability lists', () => {
    const payload = buildAgentSavePayload({
      ...createEmptyAgentFormState(),
      name: 'Scoped Agent',
      description: 'desc',
      modelSource: 'llm_provider',
      sourceId: 'p1',
      model: 'llama3',
      reasoningEffort: 'high',
      systemPrompt: 'prompt',
      mcpExclusionIds: ['mcp-a'],
      skillIds: ['global:review'],
      toolScopeMode: 'narrow',
      builtInTools: ['grep'],
      toolScopeMcpServerIds: ['mcp-b'],
    }, { id: 'agent-1' });

    expect(payload).toEqual({
      id: 'agent-1',
      name: 'Scoped Agent',
      description: 'desc',
      provider_id: 'p1',
      system_prompt: 'prompt',
      mcpServerExclusionIds: ['mcp-a'],
      skillNames: ['global:review'],
      config: {
        permissionsPreset: 'project-safe',
        approvalPreset: 'write-operations',
        toolScope: { mode: 'narrow', builtInTools: ['grep'], mcpServerIds: ['mcp-b'] },
        modelSource: 'llm_provider',
        sourceId: 'p1',
        model: 'llama3',
        reasoningEffort: 'high',
      },
    });
  });

  it('clears model keys from the inherited config when no source is selected', () => {
    const payload = buildAgentSavePayload({
      ...createEmptyAgentFormState(),
      name: 'Inheriting Agent',
    }, {
      id: 'agent-1',
      existingConfig: {
        modelSource: 'llm_provider', sourceId: 'p1', model: 'llama3', reasoningEffort: 'high',
        customFlag: true,
      },
    });

    expect(payload.provider_id).toBe(null);
    expect(payload.config).toEqual({
      customFlag: true,
      permissionsPreset: 'project-safe',
      approvalPreset: 'write-operations',
      toolScope: { mode: 'inherit' },
    });
  });

  it('drops an absent model/effort but keeps other existing config entries', () => {
    const payload = buildAgentSavePayload({
      ...createEmptyAgentFormState(),
      name: 'Subscribed Agent',
      modelSource: 'ai_subscription',
      sourceId: 'sub-1',
    }, {
      id: 'agent-1',
      existingConfig: { model: 'stale-model', reasoningEffort: 'low' },
    });

    expect(payload.provider_id).toBe(null);
    expect(payload.config).toMatchObject({ modelSource: 'ai_subscription', sourceId: 'sub-1' });
    expect(payload.config).not.toHaveProperty('model');
    expect(payload.config).not.toHaveProperty('reasoningEffort');
  });
});
