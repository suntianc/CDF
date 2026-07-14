import type { ChatRuntimeOverrides } from '../../shared/types';

interface ResolveDelegatedModelOverridesInput {
  targetProviderId?: string | null;
  targetConfig?: string | Record<string, unknown> | null;
  parentProviderId: string;
  parentOverrides?: ChatRuntimeOverrides;
}

function readExplicitModel(config: ResolveDelegatedModelOverridesInput['targetConfig']): string | null {
  let parsed: Record<string, unknown> = {};
  if (config && typeof config === 'object') {
    parsed = config;
  } else if (typeof config === 'string') {
    try {
      const value = JSON.parse(config) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return typeof parsed.model === 'string' && parsed.model.trim()
    ? parsed.model.trim()
    : null;
}

export function resolveDelegatedModelOverrides(
  input: ResolveDelegatedModelOverridesInput,
): ChatRuntimeOverrides | undefined {
  const explicitProviderId = input.targetProviderId?.trim() || null;
  const explicitModel = readExplicitModel(input.targetConfig);
  if (!explicitProviderId && !explicitModel) return input.parentOverrides;

  const providerId = explicitProviderId ?? input.parentProviderId;
  return {
    modelSource: 'llm_provider',
    sourceId: providerId,
    providerId,
    ...(explicitModel ? { model: explicitModel } : {}),
  };
}
