import {
  buildAISubscriptionTextModelCandidates,
  isMiniMaxTokenPlanTextModel,
  type AISubscriptionEntryId,
} from '../shared/ai-subscriptions';
import type { RuntimeProviderModelConfig } from './deepagent/llm-adapter';
import { getSubscriptionSecret } from './ai-subscription-credentials';
import { getAISubscriptionEntries } from './ai-subscription-store';

export class AISubscriptionRuntimeError extends Error {
  readonly code = 'AI_SUBSCRIPTION_UNAVAILABLE';
  readonly recoverable = true;
  readonly messageKey: string;
  readonly messageParams: Record<string, string | number>;

  constructor(messageKey: string, messageParams: Record<string, string | number> = {}) {
    super(messageKey);
    this.name = 'AISubscriptionRuntimeError';
    this.messageKey = messageKey;
    this.messageParams = messageParams;
  }
}

/**
 * MiniMax domestic Anthropic-compatible base (Token Plan / Coding Plan recommended protocol).
 * @see https://platform.minimaxi.com/docs/api-reference/text-anthropic-api
 */
export const MINIMAX_ANTHROPIC_API_BASE_URL = 'https://api.minimaxi.com/anthropic';

/** @deprecated Use MINIMAX_ANTHROPIC_API_BASE_URL — Token Plan text no longer uses OpenAI chat. */
export const MINIMAX_API_BASE_URL = MINIMAX_ANTHROPIC_API_BASE_URL;

/**
 * Legacy catalog aliases → live API model ids on the Token Plan allowlist.
 */
const MODEL_ALIASES: Partial<Record<AISubscriptionEntryId, Record<string, string>>> = {
  'minimax-token-plan': {
    'MiniMax reasoning': 'MiniMax-M3',
    'MiniMax-M2.5': 'MiniMax-M2.7',
    'MiniMax-M2.5-highspeed': 'MiniMax-M2.7-highspeed',
  },
};

function loadVaultedRawSecret(entryId: AISubscriptionEntryId): string | null {
  const raw = getSubscriptionSecret(entryId);
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim();
}

function resolveApiModel(entryId: AISubscriptionEntryId, catalogModel: string): string {
  return MODEL_ALIASES[entryId]?.[catalogModel] ?? catalogModel;
}

function resolveMiniMaxRuntimeConfig(
  displayName: string,
  catalogModel: string,
  contextLimit: number | undefined
): RuntimeProviderModelConfig {
  const key = loadVaultedRawSecret('minimax-token-plan');
  if (!key) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.notConnected',
      { name: displayName }
    );
  }
  const apiModel = resolveApiModel('minimax-token-plan', catalogModel);
  if (!isMiniMaxTokenPlanTextModel(apiModel)) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.modelUnsupported',
      { name: displayName }
    );
  }
  return {
    apiKey: key,
    apiUrl: MINIMAX_ANTHROPIC_API_BASE_URL,
    defaultModel: apiModel,
    // Official Token Plan / Claude Code path: Anthropic Messages API.
    providerType: 'minimax',
    model: apiModel,
    contextLimit,
  };
}

export function resolveAISubscriptionRuntimeModel(
  sourceId: string | undefined,
  selectedModel: string | undefined
): RuntimeProviderModelConfig {
  if (!sourceId) {
    throw new AISubscriptionRuntimeError('settings.aiSubscriptions.runtimeError.sourceMissing');
  }

  const entries = getAISubscriptionEntries();
  const entry = entries.find((item) => item.id === sourceId as AISubscriptionEntryId);
  if (!entry) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.sourceUnavailable',
      { sourceId }
    );
  }
  if (entry.status !== 'connected') {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.notConnected',
      { name: entry.displayName }
    );
  }

  // text.chat is always-on for Token Plan (no switch). Only enforce when the capability is declared.
  const textCapability = entry.capabilities.find((capability) => capability.capabilityId === 'text.chat');
  if (textCapability && !textCapability.enabled) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.textDisabled',
      { name: entry.displayName }
    );
  }

  const candidates = buildAISubscriptionTextModelCandidates(entries)
    .filter((candidate) => candidate.sourceId === entry.id);
  const candidate = selectedModel
    ? candidates.find((item) => item.model === selectedModel)
      ?? candidates.find((item) => item.label === selectedModel)
      ?? candidates.find((item) => resolveApiModel(entry.id, selectedModel) === item.model)
    : candidates[0];
  if (!candidate) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.modelUnsupported',
      { name: entry.displayName }
    );
  }

  if (entry.id === 'minimax-token-plan') {
    return resolveMiniMaxRuntimeConfig(entry.displayName, candidate.model, candidate.contextLimit);
  }

  throw new AISubscriptionRuntimeError(
    'settings.aiSubscriptions.runtimeError.sourceUnavailable',
    { sourceId: entry.id }
  );
}
