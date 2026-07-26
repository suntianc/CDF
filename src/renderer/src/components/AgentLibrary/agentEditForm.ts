// Pure form model behind AgentEditDialog (#236): a single form state object with
// a reducer, plus derivation/validation/payload helpers. No React or store access
// here so every branch is unit-testable.
import type { LLMProvider } from '@shared/types';
import type { ReasoningEffort } from '@shared/ai-subscriptions';
import { type Agent, type AgentToolScopeConfig } from '@shared/agents';
import type {
  ModelSelectionGroup,
  ModelSourceType,
} from '../ChatArea/modelSelection/useModelSelectionController';

export interface AgentFormState {
  name: string;
  description: string;
  modelSource: ModelSourceType | '';
  sourceId: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt: string;
  mcpExclusionIds: string[];
  skillIds: string[];
  toolScopeMode: AgentToolScopeConfig['mode'];
  builtInTools: string[];
  toolScopeMcpServerIds: string[];
}

export type AgentFormListField =
  | 'mcpExclusionIds'
  | 'skillIds'
  | 'builtInTools'
  | 'toolScopeMcpServerIds';

export type AgentFormAction =
  | { type: 'reset'; state: AgentFormState }
  | { type: 'patch'; patch: Partial<AgentFormState> }
  | { type: 'selectModel'; sourceType: ModelSourceType | ''; sourceId: string; model: string }
  | { type: 'setReasoningEffort'; effort?: ReasoningEffort }
  | { type: 'toggleListItem'; field: AgentFormListField; id: string };

export function createEmptyAgentFormState(): AgentFormState {
  return {
    name: '',
    description: '',
    modelSource: '',
    sourceId: '',
    model: '',
    reasoningEffort: undefined,
    systemPrompt: '',
    mcpExclusionIds: [],
    skillIds: [],
    toolScopeMode: 'inherit',
    builtInTools: [],
    toolScopeMcpServerIds: [],
  };
}

export function agentFormReducer(state: AgentFormState, action: AgentFormAction): AgentFormState {
  switch (action.type) {
    case 'reset':
      return action.state;
    case 'patch':
      return { ...state, ...action.patch };
    case 'selectModel':
      // Any explicit model change invalidates the previous reasoning effort.
      return {
        ...state,
        modelSource: action.sourceType,
        sourceId: action.sourceId,
        model: action.model,
        reasoningEffort: undefined,
      };
    case 'setReasoningEffort':
      return { ...state, reasoningEffort: action.effort };
    case 'toggleListItem': {
      const list = state[action.field];
      return {
        ...state,
        [action.field]: list.includes(action.id)
          ? list.filter((item) => item !== action.id)
          : [...list, action.id],
      };
    }
  }
}

function readToolScopeFromConfig(config?: Record<string, unknown>): AgentToolScopeConfig {
  const raw = config?.toolScope;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { mode: 'inherit' };
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'narrow') return { mode: 'inherit' };
  return {
    mode: 'narrow',
    builtInTools: Array.isArray(value.builtInTools)
      ? value.builtInTools.filter((item): item is string => typeof item === 'string')
      : [],
    mcpServerIds: Array.isArray(value.mcpServerIds)
      ? value.mcpServerIds.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function readReasoningEffort(value: unknown): ReasoningEffort | undefined {
  switch (value) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
    case 'ultra':
      return value;
    default:
      return undefined;
  }
}

/** The default group for a fresh Custom Agent: the active provider's group, else the first. */
export function findDefaultModelGroup(
  modelGroups: ModelSelectionGroup[],
  providers: LLMProvider[],
): ModelSelectionGroup | undefined {
  const activeProvider = providers.find((provider) => provider.is_active === 1);
  return modelGroups.find((group) => (
    group.sourceType === 'llm_provider' && group.sourceId === activeProvider?.id
  )) || modelGroups[0];
}

export interface DeriveAgentFormArgs {
  agent?: Agent;
  modelGroups: ModelSelectionGroup[];
  providers: LLMProvider[];
  providersLoading: boolean;
  aiSubscriptionsLoading: boolean;
}

/**
 * Build the initial form state for the dialog: hydrate from an existing agent's
 * persisted capabilities, or seed a fresh Custom Agent with the default model
 * group once all model sources have finished loading.
 */
export function deriveAgentFormState({
  agent,
  modelGroups,
  providers,
  providersLoading,
  aiSubscriptionsLoading,
}: DeriveAgentFormArgs): AgentFormState {
  if (!agent) {
    const selectedGroup = providersLoading || aiSubscriptionsLoading
      ? undefined
      : findDefaultModelGroup(modelGroups, providers);
    return {
      ...createEmptyAgentFormState(),
      modelSource: selectedGroup?.sourceType || '',
      sourceId: selectedGroup?.sourceId || '',
      model: selectedGroup?.candidates[0]?.model || '',
    };
  }

  const configuredModelSource = agent.config?.modelSource === 'ai_subscription'
    ? 'ai_subscription'
    : agent.config?.modelSource === 'llm_provider' || agent.provider_id
      ? 'llm_provider'
      : '';
  const configuredSourceId = configuredModelSource
    && typeof agent.config?.sourceId === 'string'
    ? agent.config.sourceId
    : agent.provider_id || '';
  const configuredGroup = modelGroups.find((group) => (
    group.sourceType === configuredModelSource && group.sourceId === configuredSourceId
  ));
  const hasConfiguredSelection = Boolean(configuredModelSource && configuredSourceId);
  const selectedGroup = configuredGroup
    || (!hasConfiguredSelection && agent.role === 'custom'
      ? findDefaultModelGroup(modelGroups, providers)
      : undefined);
  const selectedSourceType = selectedGroup?.sourceType || configuredModelSource;
  const selectedSourceId = selectedGroup?.sourceId || configuredSourceId;
  const configuredModel = typeof agent.config?.model === 'string' ? agent.config.model : '';
  const selectedModel = configuredModel || selectedGroup?.candidates[0]?.model || '';
  const selectedCandidate = selectedGroup?.candidates.find((candidate) => candidate.model === selectedModel);
  const configuredReasoningEffort = readReasoningEffort(agent.config?.reasoningEffort);
  // Keep a persisted effort only while we cannot prove the selected model rejects it.
  const preservesReasoningEffort = configuredReasoningEffort && (
    !selectedCandidate
    || selectedCandidate.reasoning?.supportedEfforts.includes(configuredReasoningEffort)
  );
  const toolScope = readToolScopeFromConfig(agent.config);

  return {
    name: agent.name,
    description: agent.description || '',
    modelSource: selectedSourceType,
    sourceId: selectedSourceId,
    model: selectedModel,
    reasoningEffort: preservesReasoningEffort ? configuredReasoningEffort : undefined,
    systemPrompt: agent.system_prompt || '',
    mcpExclusionIds: agent.mcpServerExclusionIds || [],
    skillIds: agent.skillNames || [],
    toolScopeMode: toolScope.mode,
    builtInTools: toolScope.builtInTools ?? [],
    toolScopeMcpServerIds: toolScope.mcpServerIds ?? [],
  };
}

const ENGLISH_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;

export type AgentFormValidationError =
  | 'agent.nameRequired'
  | 'agent.nameEnglishOnly'
  | 'agent.providerRequired';

export function getAgentFormValidationError(
  form: AgentFormState,
  isProtectedAgent: boolean,
): AgentFormValidationError | null {
  if (!form.name.trim()) return 'agent.nameRequired';
  if (!ENGLISH_NAME_REGEX.test(form.name.trim())) return 'agent.nameEnglishOnly';
  if (!form.sourceId && !isProtectedAgent) return 'agent.providerRequired';
  return null;
}

export interface AgentSavePayload {
  id: string;
  name: string;
  description: string;
  provider_id: string | null;
  system_prompt: string;
  config: Record<string, unknown>;
  mcpServerExclusionIds: string[];
  skillNames: string[];
}

export function buildAgentSavePayload(
  form: AgentFormState,
  { id, existingConfig }: { id: string; existingConfig?: Record<string, unknown> },
): AgentSavePayload {
  const nextConfig: Record<string, unknown> = {
    ...(existingConfig ?? {}),
    permissionsPreset: 'project-safe',
    approvalPreset: 'write-operations',
    toolScope: form.toolScopeMode === 'narrow'
      ? {
          mode: 'narrow',
          builtInTools: form.builtInTools,
          mcpServerIds: form.toolScopeMcpServerIds,
        }
      : { mode: 'inherit' },
  };
  if (form.modelSource && form.sourceId) {
    nextConfig.modelSource = form.modelSource;
    nextConfig.sourceId = form.sourceId;
    if (form.model) nextConfig.model = form.model;
    else delete nextConfig.model;
    if (form.reasoningEffort) nextConfig.reasoningEffort = form.reasoningEffort;
    else delete nextConfig.reasoningEffort;
  } else {
    delete nextConfig.modelSource;
    delete nextConfig.sourceId;
    delete nextConfig.model;
    delete nextConfig.reasoningEffort;
  }

  return {
    id,
    name: form.name,
    description: form.description,
    provider_id: form.modelSource === 'llm_provider' ? form.sourceId : null,
    system_prompt: form.systemPrompt,
    config: nextConfig,
    mcpServerExclusionIds: form.mcpExclusionIds,
    skillNames: form.skillIds,
  };
}
