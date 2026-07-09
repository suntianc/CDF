import type {
  AISubscriptionConnectionResult,
  AISubscriptionUsageSummary,
} from '../shared/ai-subscriptions';

const MINIMAX_TOKEN_PLAN_REMAINS_URL = 'https://www.minimaxi.com/v1/token_plan/remains';

interface HttpJsonResponse {
  status: number;
  body: unknown;
}

export interface MiniMaxAdapterDeps {
  httpGetJson: (url: string, headers: Record<string, string>) => Promise<HttpJsonResponse>;
}

/**
 * Provisional mapping from a MiniMax token-plan window object to used/limit.
 * The remains response schema is not publicly documented; keep this the single
 * place that knows the raw field names so a real-shape correction stays local.
 */
function readWindow(raw: unknown): { used?: number; limit?: number } {
  if (!raw || typeof raw !== 'object') return {};
  const window = raw as Record<string, unknown>;
  const used = typeof window.used === 'number' ? window.used : undefined;
  const limit = typeof window.total === 'number' ? window.total : undefined;
  return { used, limit };
}

function toUsageSummary(
  period: AISubscriptionUsageSummary['period'],
  label: string,
  raw: unknown
): AISubscriptionUsageSummary | null {
  const { used, limit } = readWindow(raw);
  if (used === undefined && limit === undefined) return null;
  const remaining = used !== undefined && limit !== undefined ? limit - used : undefined;
  return { period, label, used, limit, remaining };
}

function normalizeRemains(body: unknown): AISubscriptionUsageSummary[] {
  const plan = (body as Record<string, unknown> | null)?.token_plan;
  if (!plan || typeof plan !== 'object') return [];
  const windows = plan as Record<string, unknown>;
  return [
    toUsageSummary('weekly', 'Weekly quota', windows.weekly),
    toUsageSummary('five_hour', '5-hour quota', windows.five_hour),
  ].filter((summary): summary is AISubscriptionUsageSummary => summary !== null);
}

/**
 * Connects a MiniMax Token Plan subscription by validating the subscription key
 * against the token-plan remains endpoint.
 */
export async function connectMiniMaxTokenPlan(
  subscriptionKey: string,
  deps: MiniMaxAdapterDeps
): Promise<AISubscriptionConnectionResult> {
  let response: HttpJsonResponse;
  try {
    response = await deps.httpGetJson(MINIMAX_TOKEN_PLAN_REMAINS_URL, {
      Authorization: `Bearer ${subscriptionKey}`,
      'Content-Type': 'application/json',
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'expired' };
  }
  if (response.status !== 200) {
    return { status: 'unavailable' };
  }
  return { status: 'connected', usageSummaries: normalizeRemains(response.body) };
}
