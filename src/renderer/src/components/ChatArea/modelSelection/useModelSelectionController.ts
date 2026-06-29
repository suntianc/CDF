import { useCallback, useEffect, useMemo } from 'react';
import type { LLMProvider } from '@shared/types';

export interface SessionModelOverride {
  providerId: string;
  model: string;
}

export type SessionModelOverrides = Record<string, SessionModelOverride | undefined>;

export interface UseModelSelectionControllerOptions {
  activeSessionId: string | null;
  providers: ReadonlyArray<LLMProvider>;
  sessionModelOverrides: SessionModelOverrides;
  masterProvider: LLMProvider | null;
  setSessionModelOverride: (sessionId: string, providerId: string, model: string) => void;
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

export function useModelSelectionController({
  activeSessionId,
  providers,
  sessionModelOverrides,
  masterProvider,
  setSessionModelOverride,
}: UseModelSelectionControllerOptions) {
  const targetId = activeSessionId || '';
  const override = sessionModelOverrides[targetId] ?? null;
  const selectedProviderId = override?.providerId || '';
  const selectedModel = override?.model || '';

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );
  const currentProvider = selectedProvider || masterProvider;
  const currentModel = selectedModel || masterProvider?.default_model || '';

  const selectedProviderModels = useMemo(() => (
    selectedProvider ? getModelCandidates(selectedProvider) : []
  ), [selectedProvider]);

  useEffect(() => {
    if (providers.length === 0 || !selectedProviderId || selectedProvider) return;
    setSessionModelOverride(targetId, '', '');
  }, [
    providers.length,
    selectedProvider,
    selectedProviderId,
    setSessionModelOverride,
    targetId,
  ]);

  useEffect(() => {
    if (providers.length === 0 || !selectedProvider || !selectedModel) return;
    if (selectedProviderModels.includes(selectedModel)) return;
    setSessionModelOverride(targetId, selectedProvider.id, selectedProviderModels[0] || '');
  }, [
    providers.length,
    selectedModel,
    selectedProvider,
    selectedProviderModels,
    setSessionModelOverride,
    targetId,
  ]);

  const selectModel = useCallback(
    (providerId: string, modelName: string) => {
      setSessionModelOverride(targetId, providerId, modelName);
    },
    [setSessionModelOverride, targetId]
  );

  return {
    selectedProviderId,
    selectedModel,
    selectedProvider,
    currentProvider,
    currentModel,
    selectModel,
  };
}
