import { useCallback, useEffect, useMemo } from 'react';
import type { LLMProvider } from '@shared/types';
import {
  buildAISubscriptionTextModelCandidates,
  type AISubscriptionEntry,
  type ModelReasoningProfile,
  type ReasoningEffort,
} from '@shared/ai-subscriptions';

export interface SessionModelOverride {
  sourceType?: ModelSourceType;
  sourceId?: string;
  providerId: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export type SessionModelOverrides = Record<string, SessionModelOverride | undefined>;
export type ModelSourceType = 'llm_provider' | 'ai_subscription';

export interface ModelSelectionCandidate {
  key: string;
  sourceType: ModelSourceType;
  sourceId: string;
  sourceName: string;
  model: string;
  label: string;
  providerType?: string;
  reasoning?: ModelReasoningProfile;
}
export interface ModelSelectionGroup {
  id: string;
  sourceType: ModelSourceType;
  sourceId: string;
  sourceName: string;
  candidates: ModelSelectionCandidate[];
}

export function resolveDefaultModelSelectionCandidate(
  candidates: ReadonlyArray<ModelSelectionCandidate>,
  masterProvider: LLMProvider | null,
): ModelSelectionCandidate | null {
  const masterCandidate = masterProvider
    ? candidates.find((candidate) => (
      candidate.sourceType === 'llm_provider' &&
      candidate.sourceId === masterProvider.id &&
      candidate.model === masterProvider.default_model
    ))
    : null;
  return masterCandidate ?? candidates[0] ?? null;
}

export interface UseModelSelectionControllerOptions {
  activeSessionId: string | null;
  providers: ReadonlyArray<LLMProvider>;
  aiSubscriptionEntries?: ReadonlyArray<AISubscriptionEntry>;
  sessionModelOverrides: SessionModelOverrides;
  masterProvider: LLMProvider | null;
  setSessionModelOverride: (
    sessionId: string,
    sourceId: string,
    model: string,
    sourceType?: ModelSourceType
  ) => void;
  setSessionReasoningEffort?: (sessionId: string, effort?: ReasoningEffort) => void;
}

export function getModelCandidates(
  provider: Pick<LLMProvider, 'default_model' | 'models'>,
  selectedModel?: string
): string[] {
  return Array.from(new Set([
    provider.default_model,
    ...(provider.models ?? []),
    selectedModel,
  ].filter((model): model is string => Boolean(model))));
}

function isSelectableLLMProvider(provider: LLMProvider): boolean {
  if (provider.hasKey !== false) return true;
  if (provider.provider_type !== 'ollama') return false;
  return !provider.id.startsWith('default-') || provider.updated_at > provider.created_at;
}

function llmProviderCandidates(provider: LLMProvider): ModelSelectionCandidate[] {
  return getModelCandidates(provider).map((model) => ({
    key: `llm_provider:${provider.id}:${model}`,
    sourceType: 'llm_provider' as const,
    sourceId: provider.id,
    sourceName: provider.name,
    model,
    label: model,
    providerType: provider.provider_type,
  }));
}

export function buildModelSelectionGroups(
  providers: ReadonlyArray<LLMProvider>,
  aiSubscriptionEntries: ReadonlyArray<AISubscriptionEntry> = []
): ModelSelectionGroup[] {
  const aiSubscriptionCandidates = buildAISubscriptionTextModelCandidates(aiSubscriptionEntries)
    .map((candidate) => {
      let providerType = 'antigravity';
      if (candidate.sourceId === 'minimax-token-plan') {
        providerType = 'minimax';
      } else if (candidate.sourceId === 'codex-oauth') {
        providerType = 'codex';
      } else if (candidate.sourceId === 'xai-oauth') {
        providerType = 'grok';
      }
      return {
        key: `ai_subscription:${candidate.sourceId}:${candidate.model}`,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        model: candidate.model,
        label: candidate.label,
        reasoning: candidate.reasoning,
        providerType,
      };
    });

  const providerGroups = providers
    .filter(isSelectableLLMProvider)
    .map((provider) => ({
      id: `llm_provider:${provider.id}`,
      sourceType: 'llm_provider' as const,
      sourceId: provider.id,
      sourceName: provider.name,
      candidates: llmProviderCandidates(provider),
    }));

  const aiSubscriptionGroups = aiSubscriptionCandidates.reduce<ModelSelectionGroup[]>((groups, candidate) => {
    let group = groups.find((item) => item.sourceId === candidate.sourceId);
    if (!group) {
      group = {
        id: `ai_subscription:${candidate.sourceId}`,
        sourceType: 'ai_subscription',
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        candidates: [],
      };
      groups.push(group);
    }
    group.candidates.push(candidate);
    return groups;
  }, []);

  return [...providerGroups, ...aiSubscriptionGroups]
    .filter((group) => group.candidates.length > 0);
}

export function useModelSelectionController({
  activeSessionId,
  providers,
  aiSubscriptionEntries = [],
  sessionModelOverrides,
  masterProvider,
  setSessionModelOverride,
  setSessionReasoningEffort,
}: UseModelSelectionControllerOptions) {
  const targetId = activeSessionId || '';
  const override = sessionModelOverrides[targetId] ?? null;
  const storedSourceType: ModelSourceType = override?.sourceType ?? 'llm_provider';
  const storedSourceId = override?.sourceId || override?.providerId || '';
  const storedModel = override?.model || '';

  const modelGroups = useMemo(
    () => buildModelSelectionGroups(providers, aiSubscriptionEntries),
    [providers, aiSubscriptionEntries]
  );
  const modelCandidates = useMemo(
    () => modelGroups.flatMap((group) => group.candidates),
    [modelGroups]
  );

  const storedCandidate = useMemo(() => (
    storedSourceId && storedModel
      ? modelCandidates.find((candidate) => (
        candidate.sourceType === storedSourceType &&
        candidate.sourceId === storedSourceId &&
        candidate.model === storedModel
      )) ?? null
      : null
  ), [modelCandidates, storedModel, storedSourceId, storedSourceType]);
  const defaultCandidate = useMemo(
    () => resolveDefaultModelSelectionCandidate(modelCandidates, masterProvider),
    [masterProvider, modelCandidates]
  );
  const currentCandidate = storedCandidate || defaultCandidate;
  const selectedSourceType: ModelSourceType = currentCandidate?.sourceType ?? storedSourceType;
  const selectedSourceId = currentCandidate?.sourceId ?? storedSourceId;
  const selectedProviderId = selectedSourceType === 'llm_provider' ? selectedSourceId : '';
  const selectedModel = currentCandidate?.model ?? storedModel;
  const selectedProvider = selectedSourceType === 'llm_provider'
    ? providers.find((provider) => provider.id === selectedSourceId) ?? null
    : null;
  const currentProvider = currentCandidate?.sourceType === 'llm_provider'
    ? providers.find((provider) => provider.id === currentCandidate.sourceId) ?? masterProvider
    : null;
  const currentModel = currentCandidate?.model || masterProvider?.default_model || '';
  const currentModelLabel = currentCandidate?.label || '';
  const reasoning = currentCandidate?.reasoning;
  const selectedReasoningEffort = reasoning?.supportedEfforts.includes(override?.reasoningEffort as ReasoningEffort)
    ? override?.reasoningEffort
    : undefined;

  useEffect(() => {
    if (!storedSourceId || modelCandidates.length === 0) return;
    const sourceCandidates = modelCandidates.filter((candidate) => (
      candidate.sourceType === storedSourceType &&
      candidate.sourceId === storedSourceId
    ));
    if (sourceCandidates.length > 0) return;
    setSessionModelOverride(targetId, '', '', 'llm_provider');
  }, [
    modelCandidates,
    storedSourceId,
    storedSourceType,
    setSessionModelOverride,
    targetId,
  ]);

  useEffect(() => {
    if (!storedSourceId || !storedModel || modelCandidates.length === 0) return;
    const sourceCandidates = modelCandidates.filter((candidate) => (
      candidate.sourceType === storedSourceType &&
      candidate.sourceId === storedSourceId
    ));
    if (sourceCandidates.length === 0) return;
    if (sourceCandidates.some((candidate) => candidate.model === storedModel)) return;
    const fallback = sourceCandidates[0];
    setSessionModelOverride(targetId, fallback.sourceId, fallback.model, fallback.sourceType);
  }, [
    modelCandidates,
    storedModel,
    storedSourceId,
    storedSourceType,
    setSessionModelOverride,
    targetId,
  ]);

  useEffect(() => {
    if (!override?.reasoningEffort || !currentCandidate || !setSessionReasoningEffort) return;
    if (reasoning?.supportedEfforts.includes(override.reasoningEffort)) return;
    setSessionReasoningEffort(targetId, undefined);
  }, [
    currentCandidate,
    override?.reasoningEffort,
    reasoning,
    setSessionReasoningEffort,
    targetId,
  ]);

  const selectModel = useCallback(
    (
      sourceTypeOrProviderId: ModelSourceType | string,
      sourceIdOrModelName: string,
      modelName?: string
    ) => {
      const sourceType = modelName ? sourceTypeOrProviderId as ModelSourceType : 'llm_provider';
      const sourceId = modelName ? sourceIdOrModelName : sourceTypeOrProviderId;
      const model = modelName ?? sourceIdOrModelName;
      setSessionModelOverride(targetId, sourceId, model, sourceType);
    },
    [setSessionModelOverride, targetId]
  );

  const selectReasoningEffort = useCallback(
    (effort?: ReasoningEffort) => {
      setSessionReasoningEffort?.(targetId, effort);
    },
    [setSessionReasoningEffort, targetId]
  );

  return {
    selectedSourceType,
    selectedSourceId,
    selectedProviderId,
    selectedModel,
    selectedProvider,
    currentProvider,
    currentModel,
    currentModelLabel,
    currentCandidate,
    modelGroups,
    selectModel,
    reasoning,
    selectedReasoningEffort,
    selectReasoningEffort,
  };
}
