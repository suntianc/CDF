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
  ].filter(Boolean)));
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

  const providerGroups = providers.map((provider) => ({
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
  const selectedSourceType: ModelSourceType = override?.sourceType ?? 'llm_provider';
  const selectedSourceId = override?.sourceId || override?.providerId || '';
  const selectedProviderId = selectedSourceType === 'llm_provider' ? selectedSourceId : '';
  const selectedModel = override?.model || '';

  const modelGroups = useMemo(
    () => buildModelSelectionGroups(providers, aiSubscriptionEntries),
    [providers, aiSubscriptionEntries]
  );
  const modelCandidates = useMemo(
    () => modelGroups.flatMap((group) => group.candidates),
    [modelGroups]
  );

  const selectedProvider = useMemo(
    () => selectedSourceType === 'llm_provider'
      ? providers.find((provider) => provider.id === selectedSourceId) ?? null
      : null,
    [providers, selectedSourceId, selectedSourceType]
  );
  const selectedCandidate = useMemo(() => (
    selectedSourceId && selectedModel
      ? modelCandidates.find((candidate) => (
        candidate.sourceType === selectedSourceType &&
        candidate.sourceId === selectedSourceId &&
        candidate.model === selectedModel
      )) ?? null
      : null
  ), [modelCandidates, selectedModel, selectedSourceId, selectedSourceType]);
  const masterCandidate = useMemo(() => {
    if (!masterProvider) return null;
    return modelCandidates.find((candidate) => (
      candidate.sourceType === 'llm_provider' &&
      candidate.sourceId === masterProvider.id &&
      candidate.model === masterProvider.default_model
    )) ?? null;
  }, [masterProvider, modelCandidates]);
  const currentCandidate = selectedCandidate || masterCandidate;
  const currentProvider = currentCandidate?.sourceType === 'llm_provider'
    ? providers.find((provider) => provider.id === currentCandidate.sourceId) ?? masterProvider
    : null;
  const currentModel = currentCandidate?.model || masterProvider?.default_model || '';
  const currentModelLabel = currentCandidate
    ? `${currentCandidate.sourceName} • ${currentCandidate.label}`
    : '';
  const reasoning = currentCandidate?.reasoning;
  const selectedReasoningEffort = reasoning?.supportedEfforts.includes(override?.reasoningEffort as ReasoningEffort)
    ? override?.reasoningEffort
    : undefined;

  useEffect(() => {
    if (!selectedSourceId || modelCandidates.length === 0) return;
    const sourceCandidates = modelCandidates.filter((candidate) => (
      candidate.sourceType === selectedSourceType &&
      candidate.sourceId === selectedSourceId
    ));
    if (sourceCandidates.length > 0) return;
    setSessionModelOverride(targetId, '', '', 'llm_provider');
  }, [
    modelCandidates,
    selectedSourceId,
    selectedSourceType,
    setSessionModelOverride,
    targetId,
  ]);

  useEffect(() => {
    if (!selectedSourceId || !selectedModel || modelCandidates.length === 0) return;
    const sourceCandidates = modelCandidates.filter((candidate) => (
      candidate.sourceType === selectedSourceType &&
      candidate.sourceId === selectedSourceId
    ));
    if (sourceCandidates.length === 0) return;
    if (sourceCandidates.some((candidate) => candidate.model === selectedModel)) return;
    const fallback = sourceCandidates[0];
    setSessionModelOverride(targetId, fallback.sourceId, fallback.model, fallback.sourceType);
  }, [
    modelCandidates,
    selectedModel,
    selectedSourceId,
    selectedSourceType,
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
