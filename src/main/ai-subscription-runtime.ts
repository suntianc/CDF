import {
  buildAISubscriptionTextModelCandidates,
  isCodexOAuthTextModel,
  isMiniMaxTokenPlanTextModel,
  isXaiOAuthTextModel,
  type AISubscriptionEntry,
  type AISubscriptionEntryId,
  type ReasoningEffort,
} from '../shared/ai-subscriptions';
import { net } from 'electron';
import type { RuntimeProviderModelConfig } from './deepagent/llm-adapter';
import {
  getOAuthCredential,
  getSubscriptionSecret,
  markOAuthCredentialTerminalIfCurrent,
} from './ai-subscription-credentials';
import {
  getAISubscriptionEntries,
  prepareAISubscriptionRuntimeStatus,
  saveAISubscriptionStatus,
} from './ai-subscription-store';

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
export const CODEX_RESPONSES_API_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const XAI_RESPONSES_API_BASE_URL = 'https://api.x.ai/v1';

type OAuthSubscriptionEntryId = Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>;

interface OAuthAuthenticatedFetchDeps {
  fetchImpl?: typeof fetch;
  loadCredential?: typeof getOAuthCredential;
  markCredentialTerminal?: typeof markOAuthCredentialTerminalIfCurrent;
  refreshStatus?: typeof prepareAISubscriptionRuntimeStatus;
  markStatus?: typeof saveAISubscriptionStatus;
}

const electronProxyFetch: typeof fetch = (input, init) => net.fetch(
  input instanceof URL ? input.toString() : input,
  init
);

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

function connectionErrorKey(status: AISubscriptionEntry['status']): string {
  if (status === 'expired') return 'settings.aiSubscriptions.runtimeError.accountExpired';
  if (status === 'unavailable') return 'settings.aiSubscriptions.runtimeError.accountUnavailable';
  return 'settings.aiSubscriptions.runtimeError.notConnected';
}

function withOAuthAuthorization(
  entryId: OAuthSubscriptionEntryId,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  credential: NonNullable<ReturnType<typeof getOAuthCredential>>
): RequestInit {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.set('Authorization', `${credential.tokenType ?? 'Bearer'} ${credential.accessToken}`);

  let body = init?.body;
  if (entryId === 'codex-oauth') {
    // LangChain prepends its own SDK fingerprint to defaultHeaders. Restore
    // the first-party-shaped headers required by the ChatGPT Codex gateway at
    // the final transport boundary, where they cannot be overwritten again.
    headers.set('User-Agent', 'codex_cli_rs/0.0.0 (CDF)');
    headers.set('originator', 'codex_cli_rs');
    if (credential.accountId) {
      headers.set('ChatGPT-Account-Id', credential.accountId);
    } else {
      headers.delete('ChatGPT-Account-Id');
    }

    const requestUrl = input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : String(input);
    if (requestUrl.startsWith(`${CODEX_RESPONSES_API_BASE_URL}/responses`) && typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const inputItems = Array.isArray(parsed.input) ? parsed.input : [];
        const instructionParts: string[] = [];
        const filteredInput = inputItems.filter((item) => {
          if (!item || typeof item !== 'object') return true;
          const message = item as Record<string, unknown>;
          if (message.role !== 'system' && message.role !== 'developer') return true;
          if (typeof message.content === 'string') {
            if (message.content.trim()) instructionParts.push(message.content.trim());
          } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (!part || typeof part !== 'object') continue;
              const text = (part as Record<string, unknown>).text;
              if (typeof text === 'string' && text.trim()) instructionParts.push(text.trim());
            }
          }
          return false;
        });
        parsed.instructions = typeof parsed.instructions === 'string' && parsed.instructions.trim()
          ? parsed.instructions
          : instructionParts.join('\n\n') || 'You are an AI coding agent running in CDF.';
        parsed.input = filteredInput.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const message = item as Record<string, unknown>;
          const id = message.id;
          // LangChain may serialize an absent message id as an empty string.
          // The ChatGPT Codex gateway rejects that field rather than treating
          // it as omitted, so only retain IDs it explicitly accepts.
          if (id === undefined || (typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id))) {
            return item;
          }
          const { id: _ignoredId, ...withoutId } = message;
          return withoutId;
        });
        parsed.store = false;
        delete parsed.temperature;
        body = JSON.stringify(parsed);
      } catch {
        // Let the provider surface malformed payloads; never replace a caller
        // body with a partially transformed request.
      }
    }
  }
  return { ...init, headers, body };
}

async function shouldRefreshOAuthResponse(
  entryId: OAuthSubscriptionEntryId,
  response: Response
): Promise<boolean> {
  if (response.status === 401) return true;
  if (entryId !== 'xai-oauth' || response.status !== 403) return false;

  // xAI normally uses 403 for entitlement failures, which re-login cannot fix.
  // These provider-specific markers are the documented exception: they mean
  // the access token itself is stale and one refresh/retry is appropriate.
  try {
    const body = (await response.clone().text()).toLowerCase();
    return body.includes('[wke=unauthenticated:')
      || body.includes('oauth2 access token could not be validated');
  } catch {
    return false;
  }
}

async function isRecognizedXaiEntitlementResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().text()).toLowerCase();
    return body.includes('do not have an active grok subscription')
      || (body.includes('out of available resources') && body.includes('grok'))
      || (body.includes('does not have permission') && body.includes('grok'));
  } catch {
    return false;
  }
}

/**
 * Injects the latest vaulted OAuth token and performs one forced refresh/retry on HTTP 401.
 * The retry is intentionally bounded so a revoked account cannot enter an authentication loop.
 */
export function createOAuthAuthenticatedFetch(
  entryId: OAuthSubscriptionEntryId,
  deps: OAuthAuthenticatedFetchDeps = {}
): typeof fetch {
  const fetchImpl = deps.fetchImpl ?? (entryId === 'xai-oauth' ? electronProxyFetch : fetch);
  const loadCredential = deps.loadCredential ?? getOAuthCredential;
  const markCredentialTerminal = deps.markCredentialTerminal
    ?? markOAuthCredentialTerminalIfCurrent;
  const refreshStatus = deps.refreshStatus ?? prepareAISubscriptionRuntimeStatus;
  const markStatus = deps.markStatus ?? saveAISubscriptionStatus;

  return async (input, init) => {
    const current = loadCredential(entryId);
    if (!current?.accessToken) {
      throw new AISubscriptionRuntimeError(
        'settings.aiSubscriptions.runtimeError.notConnected',
        { name: entryId }
      );
    }
    if (current.terminalStatus) {
      throw new AISubscriptionRuntimeError(
        connectionErrorKey(current.terminalStatus),
        { name: entryId === 'xai-oauth' ? 'xAI Grok OAuth' : 'Codex OAuth' }
      );
    }

    // Preserve a retryable copy before the first request consumes a Request body.
    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await fetchImpl(
      input,
      withOAuthAuthorization(entryId, input, init, current)
    );
    if (!(await shouldRefreshOAuthResponse(entryId, response))) {
      if (entryId === 'xai-oauth' && response.status === 403) {
        let deniedCredential = current;
        let recognizedEntitlement = await isRecognizedXaiEntitlementResponse(response);
        const rotatedBySibling = loadCredential(entryId);
        if (
          rotatedBySibling?.accessToken
          && rotatedBySibling.accessToken !== current.accessToken
        ) {
          const retryResponse = await fetchImpl(
            retryInput,
            withOAuthAuthorization(entryId, retryInput, init, rotatedBySibling)
          );
          if (retryResponse.status !== 403 || await shouldRefreshOAuthResponse(entryId, retryResponse)) {
            return retryResponse;
          }
          deniedCredential = rotatedBySibling;
          recognizedEntitlement = await isRecognizedXaiEntitlementResponse(retryResponse);
        }

        // Hermes treats every non-WKE xAI 403 as non-refreshable entitlement,
        // but only a positive entitlement shape is strong enough to persist an
        // account-wide quarantine. Unknown/WAF 403s remain retryable on a later
        // user request instead of permanently disabling an otherwise valid account.
        const marked = recognizedEntitlement && markCredentialTerminal(
          entryId,
          deniedCredential,
          'unavailable',
          'xai_entitlement_denied'
        );
        const entries = marked ? markStatus(entryId, 'unavailable') : [];
        const entry = entries.find((item) => item.id === entryId);
        throw new AISubscriptionRuntimeError(
          'settings.aiSubscriptions.runtimeError.xaiEntitlementDenied',
          { name: entry?.displayName ?? 'xAI Grok OAuth' }
        );
      }
      return response;
    }

    const rotatedBySibling = loadCredential(entryId);
    if (rotatedBySibling?.accessToken && rotatedBySibling.accessToken !== current.accessToken) {
      return fetchImpl(
        retryInput,
        withOAuthAuthorization(entryId, retryInput, init, rotatedBySibling)
      );
    }

    const entries = await refreshStatus(entryId, true);
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || entry.status !== 'connected') {
      throw new AISubscriptionRuntimeError(
        connectionErrorKey(entry?.status ?? 'logged_out'),
        { name: entry?.displayName ?? entryId }
      );
    }

    const refreshed = loadCredential(entryId);
    if (!refreshed?.accessToken) {
      throw new AISubscriptionRuntimeError(
        'settings.aiSubscriptions.runtimeError.notConnected',
        { name: entry.displayName }
      );
    }
    return fetchImpl(
      retryInput,
      withOAuthAuthorization(entryId, retryInput, init, refreshed)
    );
  };
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

function resolveCodexRuntimeConfig(
  displayName: string,
  catalogModel: string,
  contextLimit: number | undefined,
  reasoningEffort?: ReasoningEffort
): RuntimeProviderModelConfig {
  const credential = getOAuthCredential('codex-oauth');
  if (credential?.terminalStatus === 'expired') {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.accountExpired',
      { name: displayName }
    );
  }
  if (!credential?.accessToken || (credential.expiresAt !== undefined && credential.expiresAt <= Date.now())) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.notConnected',
      { name: displayName }
    );
  }
  if (!isCodexOAuthTextModel(catalogModel)) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.modelUnsupported',
      { name: displayName }
    );
  }
  const defaultHeaders: Record<string, string> = {
    originator: 'codex_cli_rs',
    'User-Agent': 'codex_cli_rs/0.0.0 (CDF)',
  };
  if (credential.accountId) {
    defaultHeaders['ChatGPT-Account-Id'] = credential.accountId;
  }
  return {
    apiKey: credential.accessToken,
    apiUrl: CODEX_RESPONSES_API_BASE_URL,
    defaultModel: catalogModel,
    providerType: 'openai',
    model: catalogModel,
    contextLimit,
    maxRetries: 0,
    useResponsesApi: true,
    ...(reasoningEffort
      ? { modelKwargs: { reasoning: { effort: reasoningEffort } } }
      : {}),
    defaultHeaders,
    fetch: createOAuthAuthenticatedFetch('codex-oauth'),
  };
}

function resolveXaiRuntimeConfig(
  displayName: string,
  catalogModel: string,
  contextLimit: number | undefined,
  reasoningEffort?: ReasoningEffort
): RuntimeProviderModelConfig {
  const credential = getOAuthCredential('xai-oauth');
  if (credential?.terminalStatus === 'expired') {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.accountExpired',
      { name: displayName }
    );
  }
  if (credential?.terminalStatus === 'unavailable') {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.accountUnavailable',
      { name: displayName }
    );
  }
  if (!credential?.accessToken || (credential.expiresAt !== undefined && credential.expiresAt <= Date.now())) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.notConnected',
      { name: displayName }
    );
  }
  if (!isXaiOAuthTextModel(catalogModel)) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.modelUnsupported',
      { name: displayName }
    );
  }
  return {
    apiKey: credential.accessToken,
    apiUrl: XAI_RESPONSES_API_BASE_URL,
    defaultModel: catalogModel,
    providerType: 'openai',
    model: catalogModel,
    contextLimit,
    maxRetries: 0,
    useResponsesApi: true,
    ...(reasoningEffort
      ? { modelKwargs: { reasoning: { effort: reasoningEffort } } }
      : {}),
    fetch: createOAuthAuthenticatedFetch('xai-oauth'),
  };
}

export function resolveAISubscriptionRuntimeModel(
  sourceId: string | undefined,
  selectedModel: string | undefined,
  reasoningEffort?: ReasoningEffort
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
      connectionErrorKey(entry.status),
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
    : entry.id === 'minimax-token-plan'
      ? candidates[0]
      : undefined;
  if (!candidate) {
    throw new AISubscriptionRuntimeError(
      'settings.aiSubscriptions.runtimeError.modelUnsupported',
      { name: entry.displayName }
    );
  }
  const resolvedReasoningEffort = candidate.reasoning?.supportedEfforts.includes(
    reasoningEffort as ReasoningEffort
  )
    ? reasoningEffort
    : undefined;

  if (entry.id === 'minimax-token-plan') {
    return resolveMiniMaxRuntimeConfig(entry.displayName, candidate.model, candidate.contextLimit);
  }
  if (entry.id === 'codex-oauth') {
    return resolveCodexRuntimeConfig(
      entry.displayName,
      candidate.model,
      candidate.contextLimit,
      resolvedReasoningEffort
    );
  }
  if (entry.id === 'xai-oauth') {
    return resolveXaiRuntimeConfig(
      entry.displayName,
      candidate.model,
      candidate.contextLimit,
      resolvedReasoningEffort
    );
  }

  throw new AISubscriptionRuntimeError(
    'settings.aiSubscriptions.runtimeError.sourceUnavailable',
    { sourceId: entry.id }
  );
}

export async function prepareAISubscriptionRuntimeModel(
  sourceId: string | undefined,
  selectedModel: string | undefined,
  refreshStatus: typeof prepareAISubscriptionRuntimeStatus = prepareAISubscriptionRuntimeStatus,
  reasoningEffort?: ReasoningEffort
): Promise<RuntimeProviderModelConfig> {
  if (sourceId === 'codex-oauth' || sourceId === 'xai-oauth') {
    const entries = await refreshStatus(sourceId);
    const entry = entries.find((item) => item.id === sourceId);
    if (!entry || entry.status !== 'connected') {
      throw new AISubscriptionRuntimeError(
        connectionErrorKey(entry?.status ?? 'logged_out'),
        { name: entry?.displayName ?? sourceId }
      );
    }
  }
  return resolveAISubscriptionRuntimeModel(sourceId, selectedModel, reasoningEffort);
}
