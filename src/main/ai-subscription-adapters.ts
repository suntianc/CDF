import { randomUUID } from 'node:crypto';
import type {
  AISubscriptionConnectionResult,
  AISubscriptionLoginDescriptor,
  AISubscriptionUsageSummary,
} from '../shared/ai-subscriptions';
import {
  getOAuthCredential,
  setOAuthCredential,
  type OAuthCredential,
} from './ai-subscription-credentials';

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEVICE_USER_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const CODEX_LOGIN_TTL_MS = 15 * 60 * 1000;
const CODEX_OAUTH_USER_AGENT = 'cdf/1.0.0';
const XAI_OAUTH_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const XAI_OAUTH_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_OAUTH_SCOPE = 'openid profile email offline_access grok-cli:access api:access';

export interface OAuthHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface OAuthHttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface OAuthAdapterDeps {
  request: (request: OAuthHttpRequest) => Promise<OAuthHttpResponse>;
  now: () => number;
  randomId: () => string;
  loadCredential?: (entryId: 'codex-oauth' | 'xai-oauth') => OAuthCredential | undefined;
  saveCredential: (entryId: 'codex-oauth' | 'xai-oauth', credential: OAuthCredential) => void;
  sleep?: (milliseconds: number) => Promise<void>;
}

type OAuthSubscriptionEntryId = 'codex-oauth' | 'xai-oauth';

interface OAuthRefreshFlight {
  promise: Promise<AISubscriptionConnectionResult>;
  force: boolean;
  performedTokenRefresh: boolean;
}

function credentialVersionMatches(left: OAuthCredential, right: OAuthCredential): boolean {
  return left.accessToken === right.accessToken
    && left.refreshToken === right.refreshToken
    && left.obtainedAt === right.obtainedAt;
}

function saveRefreshedCredentialIfCurrent(
  deps: OAuthAdapterDeps,
  entryId: OAuthSubscriptionEntryId,
  previous: OAuthCredential,
  next: OAuthCredential
): AISubscriptionConnectionResult | null {
  const current = deps.loadCredential?.(entryId);
  if (!current) return { status: 'logged_out' };
  if (!credentialVersionMatches(current, previous)) {
    return { status: current.terminalStatus ?? 'connected' };
  }
  deps.saveCredential(entryId, next);
  return null;
}

function quarantineCredentialIfCurrent(
  deps: OAuthAdapterDeps,
  entryId: OAuthSubscriptionEntryId,
  previous: OAuthCredential
): AISubscriptionConnectionResult {
  const current = deps.loadCredential?.(entryId);
  if (!current) return { status: 'logged_out' };
  if (!credentialVersionMatches(current, previous)) {
    return { status: current.terminalStatus ?? 'connected' };
  }
  deps.saveCredential(entryId, { ...current, terminalStatus: 'expired' });
  return { status: 'expired' };
}

interface CodexLoginSession {
  deviceAuthId: string;
  userCode: string;
  expiresAt: number;
  pollIntervalMs: number;
}

interface XaiLoginSession {
  deviceCode: string;
  tokenEndpoint: string;
  expiresAt: number;
  pollIntervalMs: number;
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readCodexAccountMetadata(accessToken: string, idToken?: string) {
  // Unverified JWT claims are display/routing metadata only; token validity is
  // still determined by the provider and never by these decoded values.
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);
  const authClaims = accessPayload?.['https://api.openai.com/auth'];
  const accountIdClaim = authClaims && typeof authClaims === 'object' && !Array.isArray(authClaims)
    ? (authClaims as Record<string, unknown>).chatgpt_account_id
    : accessPayload?.['https://api.openai.com/auth.chatgpt_account_id'];
  const emailClaim = idPayload?.email ?? accessPayload?.email;
  return {
    ...(typeof accountIdClaim === 'string' && accountIdClaim ? { accountId: accountIdClaim } : {}),
    ...(typeof emailClaim === 'string' && emailClaim ? { email: emailClaim } : {}),
  };
}

function validateXaiEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('xAI OAuth endpoint is missing');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('xAI OAuth endpoint is invalid');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (host !== 'x.ai' && !host.endsWith('.x.ai'))) {
    throw new Error('xAI OAuth endpoint is not trusted');
  }
  return parsed.toString();
}

function normalizeUsageResetAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 9_999_999_999 ? value : value * 1000;
  }
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function codexUsageSummary(
  period: 'five_hour' | 'weekly',
  label: string,
  raw: unknown
): AISubscriptionUsageSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const window = raw as Record<string, unknown>;
  if (typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) {
    return null;
  }
  const used = Math.max(0, Math.min(100, window.used_percent));
  const resetsAt = normalizeUsageResetAt(window.reset_at);
  return {
    period,
    label,
    used,
    limit: 100,
    remaining: 100 - used,
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

async function fetchCodexUsage(
  deps: OAuthAdapterDeps,
  credential: OAuthCredential
): Promise<AISubscriptionUsageSummary[]> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
    };
    if (credential.accountId) headers['ChatGPT-Account-Id'] = credential.accountId;
    const response = await deps.request({
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers,
    });
    if (response.status !== 200 || !response.body || typeof response.body !== 'object') return [];
    const rateLimit = (response.body as Record<string, unknown>).rate_limit;
    if (!rateLimit || typeof rateLimit !== 'object') return [];
    const windows = rateLimit as Record<string, unknown>;
    return [
      codexUsageSummary('five_hour', '5-hour quota', windows.primary_window),
      codexUsageSummary('weekly', 'Weekly quota', windows.secondary_window),
    ].filter((summary): summary is AISubscriptionUsageSummary => summary !== null);
  } catch {
    return [];
  }
}

export type OAuthLoginPollOutcome =
  | { status: 'connecting'; nextPollAfterMs: number }
  | { status: 'connected' }
  | { status: 'logged_out'; reason: 'timeout' | 'denied' | 'cancelled' }
  | { status: 'unavailable'; message: string };

export interface ConnectedAccountOAuthAdapter {
  startLogin: () => Promise<{ status: 'connecting'; descriptor: AISubscriptionLoginDescriptor }>;
  pollLoginStatus: (attemptId: string) => Promise<OAuthLoginPollOutcome>;
  cancelLogin: (attemptId: string) => Promise<void>;
  refreshStatus: (options?: { includeUsage?: boolean; force?: boolean }) => Promise<AISubscriptionConnectionResult>;
}

export function createCodexOAuthAdapter(deps: OAuthAdapterDeps): ConnectedAccountOAuthAdapter {
  const sessions = new Map<string, CodexLoginSession>();
  const cancelledAttempts = new Set<string>();
  let refreshInFlight: OAuthRefreshFlight | null = null;

  const sleep = deps.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const requestUserCode = async (): Promise<OAuthHttpResponse> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await deps.request({
        method: 'POST',
        url: CODEX_DEVICE_USER_CODE_URL,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': CODEX_OAUTH_USER_AGENT,
        },
        body: { client_id: CODEX_OAUTH_CLIENT_ID },
      });
      if (response.status !== 429) return response;
      if (attempt === 3) {
        throw new Error('Codex login is rate-limited; try again later');
      }
      const retryAfterValue = Object.entries(response.headers ?? {})
        .find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
      const retryAfterSeconds = Number(retryAfterValue);
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? retryAfterSeconds * 1000
        : 2 ** (attempt + 1) * 1000;
      await sleep(Math.min(delayMs, 60_000));
    }
    throw new Error('Codex device login could not be started');
  };

  return {
    async startLogin(): Promise<{ status: 'connecting'; descriptor: AISubscriptionLoginDescriptor }> {
      const response = await requestUserCode();
      const body = response.body as Record<string, unknown> | null;
      const userCode = typeof body?.user_code === 'string' ? body.user_code : '';
      const deviceAuthId = typeof body?.device_auth_id === 'string' ? body.device_auth_id : '';
      if (response.status !== 200 || !userCode || !deviceAuthId) {
        throw new Error('Codex device login could not be started');
      }
      const intervalSeconds = typeof body?.interval === 'number' && body.interval > 0
        ? body.interval
        : 5;
      const attemptId = deps.randomId();
      const expiresAt = deps.now() + CODEX_LOGIN_TTL_MS;
      const pollIntervalMs = intervalSeconds * 1000;
      sessions.set(attemptId, { deviceAuthId, userCode, expiresAt, pollIntervalMs });

      return {
        status: 'connecting',
        descriptor: {
          attemptId,
          flow: 'device_code',
          verificationUrl: CODEX_DEVICE_VERIFICATION_URL,
          userCode,
          expiresAt,
          pollIntervalMs,
        },
      };
    },

    async pollLoginStatus(attemptId: string): Promise<OAuthLoginPollOutcome> {
      if (cancelledAttempts.delete(attemptId)) {
        return { status: 'logged_out', reason: 'cancelled' };
      }
      const session = sessions.get(attemptId);
      if (!session) {
        return { status: 'unavailable', message: 'Codex login attempt is not active' };
      }
      if (deps.now() >= session.expiresAt) {
        sessions.delete(attemptId);
        return { status: 'logged_out', reason: 'timeout' };
      }

      let pollResponse: OAuthHttpResponse;
      try {
        pollResponse = await deps.request({
          method: 'POST',
          url: CODEX_DEVICE_TOKEN_URL,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': CODEX_OAUTH_USER_AGENT,
          },
          body: {
            device_auth_id: session.deviceAuthId,
            user_code: session.userCode,
          },
        });
      } catch {
        if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
          return { status: 'logged_out', reason: 'cancelled' };
        }
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
        return { status: 'logged_out', reason: 'cancelled' };
      }
      if (pollResponse.status === 403 || pollResponse.status === 404) {
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      const pollBody = pollResponse.body as Record<string, unknown> | null;
      const authorizationCode = typeof pollBody?.authorization_code === 'string'
        ? pollBody.authorization_code
        : '';
      const codeVerifier = typeof pollBody?.code_verifier === 'string'
        ? pollBody.code_verifier
        : '';
      if (pollResponse.status !== 200 || !authorizationCode || !codeVerifier) {
        sessions.delete(attemptId);
        return { status: 'unavailable', message: 'Codex device authorization failed' };
      }

      let tokenResponse: OAuthHttpResponse;
      try {
        tokenResponse = await deps.request({
          method: 'POST',
          url: CODEX_OAUTH_TOKEN_URL,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': CODEX_OAUTH_USER_AGENT,
          },
          body: {
            grant_type: 'authorization_code',
            code: authorizationCode,
            redirect_uri: CODEX_DEVICE_REDIRECT_URI,
            client_id: CODEX_OAUTH_CLIENT_ID,
            code_verifier: codeVerifier,
          },
        });
      } catch {
        if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
          return { status: 'logged_out', reason: 'cancelled' };
        }
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
        return { status: 'logged_out', reason: 'cancelled' };
      }
      const tokenBody = tokenResponse.body as Record<string, unknown> | null;
      const accessToken = typeof tokenBody?.access_token === 'string' ? tokenBody.access_token : '';
      if (tokenResponse.status !== 200 || !accessToken) {
        sessions.delete(attemptId);
        return { status: 'unavailable', message: 'Codex token exchange failed' };
      }
      const refreshToken = typeof tokenBody?.refresh_token === 'string'
        ? tokenBody.refresh_token
        : undefined;
      const idToken = typeof tokenBody?.id_token === 'string' ? tokenBody.id_token : undefined;
      const expiresIn = typeof tokenBody?.expires_in === 'number' && tokenBody.expires_in > 0
        ? tokenBody.expires_in
        : undefined;
      const now = deps.now();
      const credential: OAuthCredential = {
        kind: 'oauth',
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(idToken ? { idToken } : {}),
        tokenType: typeof tokenBody?.token_type === 'string' ? tokenBody.token_type : 'Bearer',
        ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
        obtainedAt: now,
        ...readCodexAccountMetadata(accessToken, idToken),
      };
      deps.saveCredential('codex-oauth', credential);
      sessions.delete(attemptId);
      return { status: 'connected' };
    },

    async cancelLogin(attemptId: string): Promise<void> {
      cancelledAttempts.add(attemptId);
      sessions.delete(attemptId);
    },

    async refreshStatus(options?: { includeUsage?: boolean; force?: boolean }): Promise<AISubscriptionConnectionResult> {
      while (refreshInFlight) {
        const existingFlight = refreshInFlight;
        const result = await existingFlight.promise;
        if (!options?.force || existingFlight.force || existingFlight.performedTokenRefresh) {
          return result;
        }
      }

      let performedTokenRefresh = false;
      const promise = (async (): Promise<AISubscriptionConnectionResult> => {
        const current = deps.loadCredential?.('codex-oauth');
        if (!current) return { status: 'logged_out' };
        if (current.terminalStatus) return { status: current.terminalStatus };
        const now = deps.now();
        let credential = current;
        if (options?.force || (current.expiresAt !== undefined && current.expiresAt - now <= 120_000)) {
          performedTokenRefresh = true;
          if (!current.refreshToken) {
            return quarantineCredentialIfCurrent(deps, 'codex-oauth', current);
          }

          let response: OAuthHttpResponse;
          try {
            response = await deps.request({
              method: 'POST',
              url: CODEX_OAUTH_TOKEN_URL,
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': CODEX_OAUTH_USER_AGENT,
              },
              body: {
                grant_type: 'refresh_token',
                client_id: CODEX_OAUTH_CLIENT_ID,
                refresh_token: current.refreshToken,
              },
            });
          } catch {
            return { status: 'unavailable' };
          }
          const body = response.body as Record<string, unknown> | null;
          const nestedError = body?.error && typeof body.error === 'object'
            ? body.error as Record<string, unknown>
            : null;
          const errorCode = typeof body?.error === 'string'
            ? body.error
            : typeof nestedError?.code === 'string'
              ? nestedError.code
              : typeof nestedError?.type === 'string'
                ? nestedError.type
              : '';
          if (
            response.status === 401
            || response.status === 403
            || ['invalid_grant', 'invalid_token', 'invalid_request', 'refresh_token_reused'].includes(errorCode)
          ) {
            return quarantineCredentialIfCurrent(deps, 'codex-oauth', current);
          }
          if (response.status !== 200) return { status: 'unavailable' };
          const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
          if (!accessToken) return quarantineCredentialIfCurrent(deps, 'codex-oauth', current);
          const idToken = typeof body?.id_token === 'string' ? body.id_token : current.idToken;
          const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0
            ? body.expires_in
            : undefined;
          credential = {
            ...current,
            accessToken,
            refreshToken: typeof body?.refresh_token === 'string'
              ? body.refresh_token
              : current.refreshToken,
            tokenType: typeof body?.token_type === 'string'
              ? body.token_type
              : current.tokenType ?? 'Bearer',
            ...(idToken ? { idToken } : {}),
            ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
            obtainedAt: now,
            ...readCodexAccountMetadata(accessToken, idToken),
          };
          const saveResult = saveRefreshedCredentialIfCurrent(
            deps,
            'codex-oauth',
            current,
            credential
          );
          if (saveResult) return saveResult;
        }
        const usageSummaries = options?.includeUsage === false
          ? []
          : await fetchCodexUsage(deps, credential);
        return usageSummaries.length > 0
          ? { status: 'connected', usageSummaries }
          : { status: 'connected' };
      })();
      const flight: OAuthRefreshFlight = {
        promise,
        force: Boolean(options?.force),
        performedTokenRefresh,
      };
      refreshInFlight = flight;
      try {
        return await promise;
      } finally {
        if (refreshInFlight === flight) refreshInFlight = null;
      }
    },
  };
}

export function createXaiOAuthAdapter(deps: OAuthAdapterDeps) {
  const sessions = new Map<string, XaiLoginSession>();
  const cancelledAttempts = new Set<string>();
  let refreshInFlight: OAuthRefreshFlight | null = null;

  return {
    async startLogin(): Promise<{ status: 'connecting'; descriptor: AISubscriptionLoginDescriptor }> {
      const discoveryResponse = await deps.request({
        method: 'GET',
        url: XAI_OAUTH_DISCOVERY_URL,
        headers: { Accept: 'application/json' },
      });
      if (discoveryResponse.status !== 200) {
        throw new Error('xAI OAuth discovery failed');
      }
      const discovery = discoveryResponse.body as Record<string, unknown> | null;
      const tokenEndpoint = validateXaiEndpoint(discovery?.token_endpoint);

      const deviceResponse = await deps.request({
        method: 'POST',
        url: XAI_OAUTH_DEVICE_CODE_URL,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: {
          client_id: XAI_OAUTH_CLIENT_ID,
          scope: XAI_OAUTH_SCOPE,
        },
      });
      const body = deviceResponse.body as Record<string, unknown> | null;
      const deviceCode = typeof body?.device_code === 'string' ? body.device_code : '';
      const userCode = typeof body?.user_code === 'string' ? body.user_code : '';
      const verificationUri = validateXaiEndpoint(body?.verification_uri);
      const verificationUrl = body?.verification_uri_complete
        ? validateXaiEndpoint(body.verification_uri_complete)
        : verificationUri;
      if (deviceResponse.status !== 200 || !deviceCode || !userCode) {
        throw new Error('xAI device login could not be started');
      }
      const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : 900;
      const intervalSeconds = typeof body?.interval === 'number' && body.interval > 0
        ? body.interval
        : 5;
      const attemptId = deps.randomId();
      const expiresAt = deps.now() + expiresIn * 1000;
      const pollIntervalMs = intervalSeconds * 1000;
      sessions.set(attemptId, { deviceCode, tokenEndpoint, expiresAt, pollIntervalMs });
      return {
        status: 'connecting',
        descriptor: {
          attemptId,
          flow: 'device_code',
          verificationUrl,
          userCode,
          expiresAt,
          pollIntervalMs,
        },
      };
    },

    async pollLoginStatus(attemptId: string): Promise<OAuthLoginPollOutcome> {
      if (cancelledAttempts.delete(attemptId)) {
        return { status: 'logged_out', reason: 'cancelled' };
      }
      const session = sessions.get(attemptId);
      if (!session) {
        return { status: 'unavailable', message: 'xAI login attempt is not active' };
      }
      if (deps.now() >= session.expiresAt) {
        sessions.delete(attemptId);
        return { status: 'logged_out', reason: 'timeout' };
      }
      let response: OAuthHttpResponse;
      try {
        response = await deps.request({
          method: 'POST',
          url: validateXaiEndpoint(session.tokenEndpoint),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: XAI_OAUTH_CLIENT_ID,
            device_code: session.deviceCode,
          },
        });
      } catch {
        if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
          return { status: 'logged_out', reason: 'cancelled' };
        }
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      if (cancelledAttempts.delete(attemptId) || sessions.get(attemptId) !== session) {
        return { status: 'logged_out', reason: 'cancelled' };
      }
      const body = response.body as Record<string, unknown> | null;
      const error = typeof body?.error === 'string' ? body.error : '';
      if (error === 'authorization_pending') {
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      if (error === 'slow_down') {
        session.pollIntervalMs = Math.min(session.pollIntervalMs + 1_000, 30_000);
        return { status: 'connecting', nextPollAfterMs: session.pollIntervalMs };
      }
      if (error === 'access_denied') {
        sessions.delete(attemptId);
        return { status: 'logged_out', reason: 'denied' };
      }
      if (error === 'expired_token') {
        sessions.delete(attemptId);
        return { status: 'logged_out', reason: 'timeout' };
      }
      const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
      const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token : '';
      if (response.status !== 200 || !accessToken || !refreshToken) {
        sessions.delete(attemptId);
        return { status: 'unavailable', message: 'xAI device token exchange failed' };
      }
      const idToken = typeof body?.id_token === 'string' ? body.id_token : undefined;
      const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : undefined;
      const now = deps.now();
      deps.saveCredential('xai-oauth', {
        kind: 'oauth',
        accessToken,
        refreshToken,
        ...(idToken ? { idToken } : {}),
        tokenType: typeof body?.token_type === 'string' ? body.token_type : 'Bearer',
        ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
        obtainedAt: now,
        tokenEndpoint: validateXaiEndpoint(session.tokenEndpoint),
      });
      sessions.delete(attemptId);
      return { status: 'connected' };
    },

    async cancelLogin(attemptId: string): Promise<void> {
      cancelledAttempts.add(attemptId);
      sessions.delete(attemptId);
    },

    async refreshStatus(options?: { force?: boolean }): Promise<AISubscriptionConnectionResult> {
      while (refreshInFlight) {
        const existingFlight = refreshInFlight;
        const result = await existingFlight.promise;
        if (!options?.force || existingFlight.force || existingFlight.performedTokenRefresh) {
          return result;
        }
      }

      let performedTokenRefresh = false;
      const promise = (async (): Promise<AISubscriptionConnectionResult> => {
        const current = deps.loadCredential?.('xai-oauth');
        if (!current) return { status: 'logged_out' };
        if (current.terminalStatus) return { status: current.terminalStatus };
        const now = deps.now();
        if (!options?.force && current.expiresAt !== undefined) {
          const lifetimeMs = Math.max(0, current.expiresAt - current.obtainedAt);
          const refreshLeadMs = lifetimeMs <= 45 * 60 * 1000
            ? 120_000
            : 60 * 60 * 1000;
          if (current.expiresAt - now > refreshLeadMs) {
            return { status: 'connected' };
          }
        } else if (!options?.force) {
          return { status: 'connected' };
        }
        performedTokenRefresh = true;
        if (!current.refreshToken) {
          return quarantineCredentialIfCurrent(deps, 'xai-oauth', current);
        }
        let tokenEndpoint: string;
        try {
          tokenEndpoint = validateXaiEndpoint(current.tokenEndpoint);
        } catch {
          return { status: 'unavailable' };
        }
        let response: OAuthHttpResponse;
        try {
          response = await deps.request({
            method: 'POST',
            url: tokenEndpoint,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: {
              grant_type: 'refresh_token',
              client_id: XAI_OAUTH_CLIENT_ID,
              refresh_token: current.refreshToken,
            },
          });
        } catch {
          return { status: 'unavailable' };
        }
        if (response.status === 400 || response.status === 401) {
          return quarantineCredentialIfCurrent(deps, 'xai-oauth', current);
        }
        if (response.status === 403 || response.status !== 200) {
          return { status: 'unavailable' };
        }
        const body = response.body as Record<string, unknown> | null;
        const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
        if (!accessToken) return quarantineCredentialIfCurrent(deps, 'xai-oauth', current);
        const expiresIn = typeof body?.expires_in === 'number' && body.expires_in > 0
          ? body.expires_in
          : undefined;
        const refreshed: OAuthCredential = {
          ...current,
          accessToken,
          refreshToken: typeof body?.refresh_token === 'string'
            ? body.refresh_token
            : current.refreshToken,
          idToken: typeof body?.id_token === 'string' ? body.id_token : current.idToken,
          tokenType: typeof body?.token_type === 'string'
            ? body.token_type
            : current.tokenType ?? 'Bearer',
          ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
          obtainedAt: now,
          tokenEndpoint,
        };
        const saveResult = saveRefreshedCredentialIfCurrent(
          deps,
          'xai-oauth',
          current,
          refreshed
        );
        if (saveResult) return saveResult;
        return { status: 'connected' };
      })();
      const flight: OAuthRefreshFlight = {
        promise,
        force: Boolean(options?.force),
        performedTokenRefresh,
      };
      refreshInFlight = flight;
      try {
        return await promise;
      } finally {
        if (refreshInFlight === flight) refreshInFlight = null;
      }
    },
  };
}

async function defaultOAuthRequest(request: OAuthHttpRequest): Promise<OAuthHttpResponse> {
  const contentType = Object.entries(request.headers ?? {})
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
    ?.toLowerCase();
  let body: string | undefined;
  if (request.body !== undefined) {
    if (contentType === 'application/x-www-form-urlencoded') {
      body = new URLSearchParams(
        Object.entries(request.body as Record<string, unknown>)
          .map(([key, value]) => [key, String(value)])
      ).toString();
    } else {
      body = JSON.stringify(request.body);
    }
  }
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return {
    status: response.status,
    body: responseBody,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

let defaultCodexOAuthAdapter: ConnectedAccountOAuthAdapter | undefined;
let defaultXaiOAuthAdapter: ConnectedAccountOAuthAdapter | undefined;

export function getDefaultOAuthAdapter(
  entryId: 'codex-oauth' | 'xai-oauth'
): ConnectedAccountOAuthAdapter {
  if (entryId === 'xai-oauth') {
    defaultXaiOAuthAdapter ??= createXaiOAuthAdapter({
      request: defaultOAuthRequest,
      now: Date.now,
      randomId: randomUUID,
      loadCredential: getOAuthCredential,
      saveCredential: setOAuthCredential,
    });
    return defaultXaiOAuthAdapter;
  }
  defaultCodexOAuthAdapter ??= createCodexOAuthAdapter({
    request: defaultOAuthRequest,
    now: Date.now,
    randomId: randomUUID,
    loadCredential: getOAuthCredential,
    saveCredential: setOAuthCredential,
  });
  return defaultCodexOAuthAdapter;
}

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
