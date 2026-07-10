export const AI_SUBSCRIPTION_ENTRY_IDS = [
  'minimax-token-plan',
  'codex-oauth',
  'xai-oauth',
] as const;

export type AISubscriptionEntryId = typeof AI_SUBSCRIPTION_ENTRY_IDS[number];

export type AISubscriptionConnectionStatus =
  | 'logged_out'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'unavailable';

export type AISubscriptionCapabilityAvailability =
  | 'declared'
  | 'available'
  | 'disabled'
  | 'unknown'
  | 'unavailable';

export type CapabilityId =
  | 'text.chat'
  | 'text.reasoning'
  | 'image.generate'
  | 'image.edit'
  | 'speech.synthesize'
  | 'video.generate'
  | 'music.generate'
  | 'search.web' // kept for type compatibility; MiniMax Token Plan does NOT expose it
  | 'code.agent'
  | 'quota.status';

/**
 * CDF product allowlist for MiniMax Token Plan.
 * Narrower than the full pay-as-you-go API catalog — do not auto-expand from API overview.
 * Call conventions for each modality must follow that modality's dedicated docs.
 */
export const MINIMAX_TOKEN_PLAN_TEXT_MODELS = [
  { model: 'MiniMax-M3', label: 'MiniMax M3', contextLimit: 1_000_000 },
  { model: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed', contextLimit: 204_800 },
  { model: 'MiniMax-M2.7', label: 'MiniMax M2.7', contextLimit: 204_800 },
] as const;

export const MINIMAX_TOKEN_PLAN_IMAGE_MODELS = ['image-01'] as const;
export const MINIMAX_TOKEN_PLAN_SPEECH_MODELS = ['speech-2.8-hd', 'speech-2.8-turbo'] as const;
export const MINIMAX_TOKEN_PLAN_VIDEO_MODELS = [
  'MiniMax-Hailuo-2.3',
  'MiniMax-Hailuo-2.3-Fast',
] as const;
export const MINIMAX_TOKEN_PLAN_MUSIC_MODELS = ['music-2.6'] as const;

export const CODEX_OAUTH_TEXT_MODELS = [
  { model: 'gpt-5.5', label: 'GPT-5.5', contextLimit: 272_000 },
  { model: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', contextLimit: 272_000 },
  { model: 'gpt-5.4', label: 'GPT-5.4', contextLimit: 272_000 },
  { model: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', contextLimit: 272_000 },
  { model: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', contextLimit: 128_000 },
] as const;

export const XAI_OAUTH_TEXT_MODELS = [
  { model: 'grok-build-0.1', label: 'Grok Build 0.1', contextLimit: 256_000 },
  { model: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5 Fast', contextLimit: 200_000 },
  { model: 'grok-4.5', label: 'Grok 4.5', contextLimit: 500_000 },
  { model: 'grok-4.3', label: 'Grok 4.3', contextLimit: 1_000_000 },
  { model: 'grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning', contextLimit: 2_000_000 },
  { model: 'grok-4.20-0309-non-reasoning', label: 'Grok 4.20 Non-Reasoning', contextLimit: 2_000_000 },
  { model: 'grok-4.20-multi-agent-0309', label: 'Grok 4.20 Multi-Agent', contextLimit: 2_000_000 },
] as const;

export function isMiniMaxTokenPlanTextModel(model: string): boolean {
  return MINIMAX_TOKEN_PLAN_TEXT_MODELS.some((item) => item.model === model);
}

export function isCodexOAuthTextModel(model: string): boolean {
  return CODEX_OAUTH_TEXT_MODELS.some((item) => item.model === model);
}

export function isXaiOAuthTextModel(model: string): boolean {
  return XAI_OAUTH_TEXT_MODELS.some((item) => item.model === model);
}

export interface PersistedAISubscriptionEntryState {
  status?: AISubscriptionConnectionStatus;
  usageSummaries?: AISubscriptionUsageSummary[];
  capabilities?: Partial<Record<CapabilityId, boolean>>;
}

export interface PersistedAISubscriptionState {
  entries?: Partial<Record<AISubscriptionEntryId, PersistedAISubscriptionEntryState>>;
}

export interface AISubscriptionCapability {
  capabilityId: CapabilityId;
  label: string;
  enabled: boolean;
  switchDisabled: boolean;
  availability: AISubscriptionCapabilityAvailability;
}

export interface AISubscriptionUsageSummary {
  period: 'five_hour' | 'weekly' | 'monthly' | 'other';
  label: string;
  used?: number;
  limit?: number;
  remaining?: number;
  resetsAt?: number;
  unavailableReason?: string;
}

export interface AISubscriptionTextModelCandidate {
  sourceType: 'ai_subscription';
  sourceId: AISubscriptionEntryId;
  sourceName: string;
  model: string;
  label: string;
  contextLimit: number;
}

export interface AISubscriptionEntry {
  id: AISubscriptionEntryId;
  displayName: string;
  status: AISubscriptionConnectionStatus;
  usageSummaries: AISubscriptionUsageSummary[];
  capabilities: AISubscriptionCapability[];
}

export interface AISubscriptionCapabilityRoute {
  sourceType: 'ai_subscription';
  entryId: AISubscriptionEntryId;
  displayName: string;
  capabilityId: CapabilityId;
}

export interface AISubscriptionConnectionResult {
  status: AISubscriptionConnectionStatus;
  usageSummaries?: AISubscriptionUsageSummary[];
}

export interface AISubscriptionLoginDescriptor {
  attemptId: string;
  flow: 'device_code';
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}

export interface AISubscriptionLoginStartResult {
  entries: AISubscriptionEntry[];
  descriptor: AISubscriptionLoginDescriptor;
}

export interface AISubscriptionLoginPollResult {
  entries: AISubscriptionEntry[];
  status: AISubscriptionConnectionStatus;
  nextPollAfterMs?: number;
  reason?: string;
  message?: string;
}

interface AISubscriptionDefinition {
  id: AISubscriptionEntryId;
  displayName: string;
  capabilities: Array<{
    capabilityId: CapabilityId;
    label: string;
  }>;
  textModels: Array<{
    model: string;
    label: string;
    contextLimit: number;
  }>;
}

const AI_SUBSCRIPTION_DEFINITIONS: AISubscriptionDefinition[] = [
  {
    id: 'minimax-token-plan',
    displayName: 'MiniMax Token Plan',
    // text.chat / text.reasoning / quota.status are always on for Token Plan (no switches).
    capabilities: [
      { capabilityId: 'image.generate', label: 'Image generation' },
      { capabilityId: 'image.edit', label: 'Image editing' },
      { capabilityId: 'speech.synthesize', label: 'Speech generation' },
      { capabilityId: 'video.generate', label: 'Video generation' },
      { capabilityId: 'music.generate', label: 'Music generation' },
      // web_search intentionally omitted for Token Plan
    ],
    // Token Plan text allowlist: M3 + M2.7 (+ highspeed) only. Claude/Anthropic protocol at runtime.
    textModels: MINIMAX_TOKEN_PLAN_TEXT_MODELS.map((item) => ({ ...item })),
  },
  {
    id: 'codex-oauth',
    displayName: 'Codex OAuth',
    capabilities: [
      // Chat, reasoning, code, vision input, and quota share the selected model/account
      // path and are therefore implicit. Only separately routable media tools are switches.
      { capabilityId: 'image.generate', label: 'Image generation' },
      { capabilityId: 'image.edit', label: 'Image editing' },
    ],
    textModels: CODEX_OAUTH_TEXT_MODELS.map((item) => ({ ...item })),
  },
  {
    id: 'xai-oauth',
    displayName: 'xAI Grok OAuth',
    // Text, reasoning, and image understanding are implicit on the selected model path.
    capabilities: [],
    textModels: XAI_OAUTH_TEXT_MODELS.map((item) => ({ ...item })),
  },
];

const CONNECTION_STATUSES = new Set<AISubscriptionConnectionStatus>([
  'logged_out',
  'connecting',
  'connected',
  'expired',
  'unavailable',
]);

const USAGE_PERIODS = new Set<AISubscriptionUsageSummary['period']>([
  'five_hour',
  'weekly',
  'monthly',
  'other',
]);

function normalizeStatus(value: unknown): AISubscriptionConnectionStatus {
  return CONNECTION_STATUSES.has(value as AISubscriptionConnectionStatus)
    ? value as AISubscriptionConnectionStatus
    : 'logged_out';
}

function normalizeUsageSummaries(value: unknown): AISubscriptionUsageSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const summary = item as Partial<AISubscriptionUsageSummary>;
    const period = USAGE_PERIODS.has(summary.period as AISubscriptionUsageSummary['period'])
      ? summary.period as AISubscriptionUsageSummary['period']
      : 'other';
    const label = typeof summary.label === 'string' && summary.label.trim()
      ? summary.label
      : period;
    return [{
      period,
      label,
      used: typeof summary.used === 'number' ? summary.used : undefined,
      limit: typeof summary.limit === 'number' ? summary.limit : undefined,
      remaining: typeof summary.remaining === 'number' ? summary.remaining : undefined,
      resetsAt: typeof summary.resetsAt === 'number' ? summary.resetsAt : undefined,
      unavailableReason: typeof summary.unavailableReason === 'string' ? summary.unavailableReason : undefined,
    }];
  });
}

function availabilityFor(status: AISubscriptionConnectionStatus, enabled: boolean): AISubscriptionCapabilityAvailability {
  if (!enabled) return 'disabled';
  if (status === 'connected') return 'available';
  if (status === 'unavailable') return 'unavailable';
  if (status === 'expired') return 'unavailable';
  return 'declared';
}

function entryDefinition(id: AISubscriptionEntryId): AISubscriptionDefinition {
  const definition = AI_SUBSCRIPTION_DEFINITIONS.find((item) => item.id === id);
  if (!definition) {
    throw new Error(`Unknown AI subscription entry: ${id}`);
  }
  return definition;
}

function assertEntryCapability(entryId: AISubscriptionEntryId, capabilityId: CapabilityId): void {
  const definition = entryDefinition(entryId);
  if (!definition.capabilities.some((capability) => capability.capabilityId === capabilityId)) {
    throw new Error(`AI subscription ${entryId} does not declare capability ${capabilityId}`);
  }
}

export function buildAISubscriptionEntries(
  persisted: PersistedAISubscriptionState = {}
): AISubscriptionEntry[] {
  return AI_SUBSCRIPTION_DEFINITIONS.map((definition) => {
    const stored = persisted.entries?.[definition.id];
    const status = normalizeStatus(stored?.status);
    const capabilities = definition.capabilities.map((capability) => {
      const enabled = stored?.capabilities?.[capability.capabilityId] ?? true;
      return {
        ...capability,
        enabled,
        switchDisabled: status !== 'connected',
        availability: availabilityFor(status, enabled),
      };
    });

    return {
      id: definition.id,
      displayName: definition.displayName,
      status,
      usageSummaries: normalizeUsageSummaries(stored?.usageSummaries),
      capabilities,
    };
  });
}

export function setAISubscriptionCapabilityEnabled(
  persisted: PersistedAISubscriptionState,
  entryId: AISubscriptionEntryId,
  capabilityId: CapabilityId,
  enabled: boolean
): PersistedAISubscriptionState {
  assertEntryCapability(entryId, capabilityId);
  const entryState = persisted.entries?.[entryId] ?? {};
  return {
    ...persisted,
    entries: {
      ...(persisted.entries ?? {}),
      [entryId]: {
        ...entryState,
        capabilities: {
          ...(entryState.capabilities ?? {}),
          [capabilityId]: enabled,
        },
      },
    },
  };
}

export function setAISubscriptionStatus(
  persisted: PersistedAISubscriptionState,
  entryId: AISubscriptionEntryId,
  status: AISubscriptionConnectionStatus
): PersistedAISubscriptionState {
  entryDefinition(entryId);
  return {
    ...persisted,
    entries: {
      ...(persisted.entries ?? {}),
      [entryId]: {
        ...(persisted.entries?.[entryId] ?? {}),
        status,
      },
    },
  };
}

export function setAISubscriptionConnectionResult(
  persisted: PersistedAISubscriptionState,
  entryId: AISubscriptionEntryId,
  result: AISubscriptionConnectionResult
): PersistedAISubscriptionState {
  entryDefinition(entryId);
  return {
    ...persisted,
    entries: {
      ...(persisted.entries ?? {}),
      [entryId]: {
        ...(persisted.entries?.[entryId] ?? {}),
        status: result.status,
        ...(result.usageSummaries !== undefined
          ? { usageSummaries: normalizeUsageSummaries(result.usageSummaries) }
          : {}),
      },
    },
  };
}

export function selectAISubscriptionCapabilityRoutes(
  entries: ReadonlyArray<AISubscriptionEntry>,
  capabilityId: CapabilityId
): AISubscriptionCapabilityRoute[] {
  return entries.flatMap((entry) => {
    if (entry.status !== 'connected') return [];
    const capability = entry.capabilities.find((item) => item.capabilityId === capabilityId);
    if (!capability?.enabled) return [];
    return [{
      sourceType: 'ai_subscription' as const,
      entryId: entry.id,
      displayName: entry.displayName,
      capabilityId,
    }];
  });
}

export function buildAISubscriptionTextModelCandidates(
  entries: ReadonlyArray<AISubscriptionEntry>
): AISubscriptionTextModelCandidate[] {
  return entries.flatMap((entry) => {
    if (entry.status !== 'connected') return [];
    // text.chat switch is optional: when undeclared (e.g. MiniMax Token Plan), text is always on.
    const textCapability = entry.capabilities.find((item) => item.capabilityId === 'text.chat');
    if (textCapability && !textCapability.enabled) return [];
    const definition = entryDefinition(entry.id);
    if (definition.textModels.length === 0) return [];
    return definition.textModels.map((model) => ({
      sourceType: 'ai_subscription' as const,
      sourceId: entry.id,
      sourceName: entry.displayName,
      model: model.model,
      label: model.label,
      contextLimit: model.contextLimit,
    }));
  });
}
