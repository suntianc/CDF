import type { ChatRuntimeOverrides } from '../../shared/types';

interface ResolveDelegatedModelOverridesInput {
  targetProviderId?: string | null;
  targetConfig?: string | Record<string, unknown> | null;
  parentProviderId: string;
  parentOverrides?: ChatRuntimeOverrides;
}

function readTargetConfig(config: ResolveDelegatedModelOverridesInput['targetConfig']): Record<string, unknown> {
  if (config && typeof config === 'object') return config;
  if (typeof config !== 'string') return {};
  try {
    const value = JSON.parse(config) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readReasoningEffort(value: unknown): ChatRuntimeOverrides['reasoningEffort'] {
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

export function resolveDelegatedModelOverrides(
  input: ResolveDelegatedModelOverridesInput,
): ChatRuntimeOverrides | undefined {
  const targetConfig = readTargetConfig(input.targetConfig);
  const configuredModelSource = targetConfig.modelSource === 'ai_subscription'
    ? 'ai_subscription'
    : targetConfig.modelSource === 'llm_provider'
      ? 'llm_provider'
      : null;
  const configuredSourceId = readNonEmptyString(targetConfig.sourceId);
  const explicitModel = readNonEmptyString(targetConfig.model);

  if (configuredModelSource === 'ai_subscription' && configuredSourceId) {
    const reasoningEffort = readReasoningEffort(targetConfig.reasoningEffort);
    return {
      modelSource: 'ai_subscription',
      sourceId: configuredSourceId,
      ...(explicitModel ? { model: explicitModel } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  }

  const explicitProviderId = input.targetProviderId?.trim()
    || (configuredModelSource === 'llm_provider' ? configuredSourceId : null);
  if (!explicitProviderId && !explicitModel) return input.parentOverrides;

  const providerId = explicitProviderId ?? input.parentProviderId;
  return {
    modelSource: 'llm_provider',
    sourceId: providerId,
    providerId,
    ...(explicitModel ? { model: explicitModel } : {}),
  };
}
