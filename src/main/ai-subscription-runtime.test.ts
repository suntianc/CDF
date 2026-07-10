import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AISubscriptionEntry } from '../shared/ai-subscriptions';
import type { OAuthCredential } from './ai-subscription-credentials';

const {
  getEntriesMock,
  getSecretMock,
  getOAuthCredentialMock,
  markCredentialTerminalMock,
  prepareRuntimeStatusMock,
  saveStatusMock,
} = vi.hoisted(() => ({
  getEntriesMock: vi.fn(),
  getSecretMock: vi.fn(),
  getOAuthCredentialMock: vi.fn(),
  markCredentialTerminalMock: vi.fn(),
  prepareRuntimeStatusMock: vi.fn(),
  saveStatusMock: vi.fn(),
}));

vi.mock('./ai-subscription-store', () => ({
  getAISubscriptionEntries: getEntriesMock,
  prepareAISubscriptionRuntimeStatus: prepareRuntimeStatusMock,
  saveAISubscriptionStatus: saveStatusMock,
}));

vi.mock('./ai-subscription-credentials', () => ({
  getSubscriptionSecret: getSecretMock,
  getOAuthCredential: getOAuthCredentialMock,
  markOAuthCredentialTerminalIfCurrent: markCredentialTerminalMock,
}));

import {
  AISubscriptionRuntimeError,
  createOAuthAuthenticatedFetch,
  MINIMAX_ANTHROPIC_API_BASE_URL,
  prepareAISubscriptionRuntimeModel,
  resolveAISubscriptionRuntimeModel,
} from './ai-subscription-runtime';

function connectedMiniMax(overrides: Partial<AISubscriptionEntry> = {}): AISubscriptionEntry {
  return {
    id: 'minimax-token-plan',
    displayName: 'MiniMax Token Plan',
    status: 'connected',
    usageSummaries: [],
    // Token Plan has no text.chat switch — text is always on when connected.
    capabilities: [],
    ...overrides,
  };
}

function connectedCodex(overrides: Partial<AISubscriptionEntry> = {}): AISubscriptionEntry {
  return {
    id: 'codex-oauth',
    displayName: 'Codex OAuth',
    status: 'connected',
    usageSummaries: [],
    capabilities: [],
    ...overrides,
  };
}

function connectedXai(overrides: Partial<AISubscriptionEntry> = {}): AISubscriptionEntry {
  return {
    id: 'xai-oauth',
    displayName: 'xAI Grok OAuth',
    status: 'connected',
    usageSummaries: [],
    capabilities: [],
    ...overrides,
  };
}

describe('resolveAISubscriptionRuntimeModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSecretMock.mockReturnValue(undefined);
    getOAuthCredentialMock.mockReturnValue(undefined);
    markCredentialTerminalMock.mockReturnValue(true);
  });

  it('resolves connected MiniMax Token Plan via Anthropic/Claude-compatible runtime', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.7');

    expect(config).toEqual({
      apiKey: 'sk-minimax-token-plan',
      apiUrl: MINIMAX_ANTHROPIC_API_BASE_URL,
      defaultModel: 'MiniMax-M2.7',
      providerType: 'minimax',
      model: 'MiniMax-M2.7',
      contextLimit: 204_800,
    });
  });

  it('defaults to MiniMax-M3 when none is selected', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', undefined);
    expect(config.model).toBe('MiniMax-M3');
    expect(config.providerType).toBe('minimax');
    expect(config.apiUrl).toBe(MINIMAX_ANTHROPIC_API_BASE_URL);
    expect(config.contextLimit).toBe(1_000_000);
  });

  it('maps legacy M2.5 selections onto the Token Plan M2.7 allowlist', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue('sk-minimax-token-plan');

    const config = resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.5');
    expect(config.model).toBe('MiniMax-M2.7');
    expect(config.providerType).toBe('minimax');
  });

  it('refuses a connected MiniMax card that has no vaulted key', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax()]);
    getSecretMock.mockReturnValue(undefined);

    try {
      resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M2.7');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AISubscriptionRuntimeError);
      const runtimeError = error as AISubscriptionRuntimeError;
      expect(runtimeError.messageKey).toBe('settings.aiSubscriptions.runtimeError.notConnected');
    }
  });

  it('raises a recoverable, localizable error for a disconnected account', () => {
    getEntriesMock.mockReturnValue([connectedMiniMax({ status: 'expired' })]);

    try {
      resolveAISubscriptionRuntimeModel('minimax-token-plan', 'MiniMax-M3');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AISubscriptionRuntimeError);
      const runtimeError = error as AISubscriptionRuntimeError;
      expect(runtimeError.recoverable).toBe(true);
      expect(runtimeError.messageKey).toBe('settings.aiSubscriptions.runtimeError.accountExpired');
      expect(runtimeError.messageParams.name).toBe('MiniMax Token Plan');
    }
  });

  it.each([
    ['expired', 'settings.aiSubscriptions.runtimeError.accountExpired'],
    ['unavailable', 'settings.aiSubscriptions.runtimeError.accountUnavailable'],
  ] as const)('distinguishes a %s OAuth account from a merely logged-out account', (status, messageKey) => {
    getEntriesMock.mockReturnValue([connectedXai({ status })]);

    expect(() => resolveAISubscriptionRuntimeModel('xai-oauth', 'grok-4.5')).toThrowError(
      expect.objectContaining({
        code: 'AI_SUBSCRIPTION_UNAVAILABLE',
        messageKey,
      })
    );
  });

  it('resolves a connected Codex account through the ChatGPT Responses runtime', () => {
    getEntriesMock.mockReturnValue([connectedCodex()]);
    getOAuthCredentialMock.mockReturnValue({
      kind: 'oauth',
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      obtainedAt: Date.now(),
      accountId: 'account-1',
    });

    const config = resolveAISubscriptionRuntimeModel('codex-oauth', 'gpt-5.4');

    expect(config).toEqual({
      apiKey: 'codex-access-token',
      apiUrl: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.4',
      providerType: 'openai',
      model: 'gpt-5.4',
      contextLimit: 272_000,
      maxRetries: 0,
      useResponsesApi: true,
      defaultHeaders: {
        originator: 'codex_cli_rs',
        'User-Agent': 'codex_cli_rs/0.0.0 (CDF)',
        'ChatGPT-Account-Id': 'account-1',
      },
      fetch: expect.any(Function),
    });
  });

  it('resolves an explicitly selected Grok model through the xAI Responses runtime', () => {
    getEntriesMock.mockReturnValue([connectedXai()]);
    getOAuthCredentialMock.mockReturnValue({
      kind: 'oauth',
      accessToken: 'xai-access-token',
      refreshToken: 'xai-refresh-token',
      expiresAt: Date.now() + 900_000,
      obtainedAt: Date.now(),
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    });

    const config = resolveAISubscriptionRuntimeModel('xai-oauth', 'grok-composer-2.5-fast');

    expect(config).toEqual({
      apiKey: 'xai-access-token',
      apiUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-composer-2.5-fast',
      providerType: 'openai',
      model: 'grok-composer-2.5-fast',
      contextLimit: 200_000,
      maxRetries: 0,
      useResponsesApi: true,
      fetch: expect.any(Function),
    });
  });

  it('requires an explicit model for OAuth accounts instead of silently pinning a drifting default', () => {
    getEntriesMock.mockReturnValue([connectedXai()]);
    getOAuthCredentialMock.mockReturnValue({
      kind: 'oauth',
      accessToken: 'xai-access-token',
      refreshToken: 'xai-refresh-token',
      expiresAt: Date.now() + 900_000,
      obtainedAt: Date.now(),
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    });

    expect(() => resolveAISubscriptionRuntimeModel('xai-oauth', undefined)).toThrowError(
      expect.objectContaining({
        code: 'AI_SUBSCRIPTION_UNAVAILABLE',
        messageKey: 'settings.aiSubscriptions.runtimeError.modelUnsupported',
      })
    );
  });

  it('refreshes an expiring OAuth account before resolving its runtime model', async () => {
    let refreshed = false;
    getEntriesMock.mockImplementation(() => [
      connectedCodex({ status: refreshed ? 'connected' : 'expired' }),
    ]);
    getOAuthCredentialMock.mockImplementation(() => refreshed
      ? {
          kind: 'oauth',
          accessToken: 'fresh-codex-access-token',
          refreshToken: 'fresh-codex-refresh-token',
          expiresAt: Date.now() + 3_600_000,
          obtainedAt: Date.now(),
        }
      : {
          kind: 'oauth',
          accessToken: 'expired-codex-access-token',
          refreshToken: 'old-codex-refresh-token',
          expiresAt: Date.now() - 1_000,
          obtainedAt: Date.now() - 3_600_000,
        });
    const refreshStatus = vi.fn().mockImplementation(async () => {
      refreshed = true;
      return [connectedCodex()];
    });

    const config = await prepareAISubscriptionRuntimeModel(
      'codex-oauth',
      'gpt-5.4',
      refreshStatus
    );

    expect(refreshStatus).toHaveBeenCalledWith('codex-oauth');
    expect(config.apiKey).toBe('fresh-codex-access-token');
    expect(config.useResponsesApi).toBe(true);
  });

  it('refreshes OAuth credentials once after a runtime 401 and retries with the rotated access token', async () => {
    let credential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'old-refresh-token',
      obtainedAt: Date.now(),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const refreshStatus = vi.fn().mockImplementation(async (_entryId: string, force?: boolean) => {
      expect(force).toBe(true);
      credential = {
        kind: 'oauth',
        accessToken: 'rotated-access-token',
        refreshToken: 'rotated-refresh-token',
        obtainedAt: Date.now(),
      };
      return [connectedXai()];
    });
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus,
    });

    const response = await authenticatedFetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer stale-access-token' },
    });

    expect(response.status).toBe(200);
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0][1]?.headers as Headers).get('Authorization')).toBe('Bearer stale-access-token');
    expect((fetchImpl.mock.calls[1][1]?.headers as Headers).get('Authorization')).toBe('Bearer rotated-access-token');
  });

  it('reuses a token already rotated by a sibling request instead of consuming another refresh token', async () => {
    let credential = {
      kind: 'oauth' as const,
      accessToken: 'shared-stale-token',
      refreshToken: 'refresh-token-1',
      obtainedAt: Date.now(),
    };
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    let initialRequests = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      if (initialRequests === 0) {
        initialRequests += 1;
        return firstResponse;
      }
      if (initialRequests === 1) {
        initialRequests += 1;
        return secondResponse;
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const refreshStatus = vi.fn().mockImplementation(async () => {
      credential = {
        kind: 'oauth',
        accessToken: 'shared-fresh-token',
        refreshToken: 'refresh-token-2',
        obtainedAt: Date.now(),
      };
      return [connectedXai()];
    });
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus,
    });

    const first = authenticatedFetch('https://api.x.ai/v1/responses');
    const second = authenticatedFetch('https://api.x.ai/v1/responses');
    resolveFirst(new Response('unauthorized', { status: 401 }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    resolveSecond(new Response('unauthorized', { status: 401 }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]);
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect((fetchImpl.mock.calls[3][1]?.headers as Headers).get('Authorization')).toBe('Bearer shared-fresh-token');
  });

  it('refreshes xAI credentials for the provider-specific stale-token 403 marker', async () => {
    let credential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'old-refresh-token',
      obtainedAt: Date.now(),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'OAuth2 access token could not be validated [WKE=unauthenticated:expired]',
      }), { status: 403 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const refreshStatus = vi.fn().mockImplementation(async () => {
      credential = { ...credential, accessToken: 'rotated-access-token' };
      return [connectedXai()];
    });
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus,
    });

    const response = await authenticatedFetch('https://api.x.ai/v1/responses');

    expect(response.status).toBe(200);
    expect(refreshStatus).toHaveBeenCalledWith('xai-oauth', true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks an ordinary xAI 403 entitlement denial unavailable without refreshing credentials', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'valid-access-token',
      refreshToken: 'refresh-token',
      obtainedAt: Date.now(),
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'You do not have an active Grok subscription',
    }), { status: 403 }));
    const refreshStatus = vi.fn();
    const markStatus = vi.fn().mockReturnValue([connectedXai({ status: 'unavailable' })]);
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus,
      markStatus,
    });

    await expect(authenticatedFetch('https://api.x.ai/v1/responses')).rejects.toEqual(
      expect.objectContaining({
        code: 'AI_SUBSCRIPTION_UNAVAILABLE',
        messageKey: 'settings.aiSubscriptions.runtimeError.xaiEntitlementDenied',
      })
    );

    expect(markStatus).toHaveBeenCalledWith('xai-oauth', 'unavailable');
    expect(markCredentialTerminalMock).toHaveBeenCalledWith(
      'xai-oauth',
      credential,
      'unavailable',
      'xai_entitlement_denied'
    );
    expect(refreshStatus).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not permanently quarantine an xAI credential for an unrecognized 403 body', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'valid-access-token',
      refreshToken: 'refresh-token',
      obtainedAt: Date.now(),
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Forbidden by an upstream edge policy',
    }), { status: 403 }));
    const refreshStatus = vi.fn();
    const markStatus = vi.fn().mockReturnValue([connectedXai({ status: 'unavailable' })]);
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus,
      markStatus,
      markCredentialTerminal: markCredentialTerminalMock,
    });

    await expect(authenticatedFetch('https://api.x.ai/v1/responses')).rejects.toEqual(
      expect.objectContaining({
        messageKey: 'settings.aiSubscriptions.runtimeError.xaiEntitlementDenied',
      })
    );

    expect(markCredentialTerminalMock).not.toHaveBeenCalled();
    expect(markStatus).not.toHaveBeenCalled();
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  it('keeps an xAI entitlement denial unavailable on the next runtime preparation', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth',
      accessToken: 'valid-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 900_000,
      obtainedAt: Date.now(),
    };
    let entry = connectedXai();
    getOAuthCredentialMock.mockImplementation(() => credential);
    getEntriesMock.mockImplementation(() => [entry]);
    markCredentialTerminalMock.mockImplementation((_entryId, expected, terminalStatus, terminalReason) => {
      if (expected.accessToken !== credential.accessToken) return false;
      credential = { ...credential, terminalStatus, terminalReason };
      return true;
    });
    saveStatusMock.mockImplementation((_entryId, status) => {
      entry = connectedXai({ status });
      return [entry];
    });
    prepareRuntimeStatusMock.mockImplementation(async () => [
      connectedXai({ status: credential.terminalStatus ?? 'connected' }),
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'You do not have an active Grok subscription',
    }), { status: 403 }));
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', { fetchImpl });

    await expect(authenticatedFetch('https://api.x.ai/v1/responses')).rejects.toEqual(
      expect.objectContaining({
        messageKey: 'settings.aiSubscriptions.runtimeError.xaiEntitlementDenied',
      })
    );
    await expect(authenticatedFetch('https://api.x.ai/v1/responses')).rejects.toEqual(
      expect.objectContaining({
        messageKey: 'settings.aiSubscriptions.runtimeError.accountUnavailable',
      })
    );
    await expect(prepareAISubscriptionRuntimeModel('xai-oauth', 'grok-4.5')).rejects.toEqual(
      expect.objectContaining({
        messageKey: 'settings.aiSubscriptions.runtimeError.accountUnavailable',
      })
    );

    expect(credential).toMatchObject({
      terminalStatus: 'unavailable',
      terminalReason: 'xai_entitlement_denied',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries an ordinary xAI 403 with a token rotated by a sibling before quarantining it', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth',
      accessToken: 'stale-access-token',
      refreshToken: 'stale-refresh-token',
      obtainedAt: Date.now(),
    };
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const authenticatedFetch = createOAuthAuthenticatedFetch('xai-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      markCredentialTerminal: markCredentialTerminalMock,
    });

    const pending = authenticatedFetch('https://api.x.ai/v1/responses');
    credential = {
      ...credential,
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      obtainedAt: credential.obtainedAt + 1,
    };
    resolveFirst(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));

    await expect(pending).resolves.toEqual(expect.objectContaining({ status: 200 }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1][1]?.headers as Headers).get('Authorization')).toBe(
      'Bearer rotated-access-token'
    );
    expect(markCredentialTerminalMock).not.toHaveBeenCalled();
  });

  it('normalizes the Codex Responses wire contract and restores first-party headers', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      obtainedAt: Date.now(),
      accountId: 'account-1',
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const authenticatedFetch = createOAuthAuthenticatedFetch('codex-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus: vi.fn(),
    });

    await authenticatedFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'langchainjs-openai/1.0.0',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        temperature: 0,
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: 'Project instructions' }] },
          { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
        ],
      }),
    });

    const sentInit = fetchImpl.mock.calls[0][1] as RequestInit;
    const sentHeaders = sentInit.headers as Headers;
    const sentBody = JSON.parse(String(sentInit.body));
    expect(sentHeaders.get('User-Agent')).toBe('codex_cli_rs/0.0.0 (CDF)');
    expect(sentHeaders.get('originator')).toBe('codex_cli_rs');
    expect(sentHeaders.get('ChatGPT-Account-Id')).toBe('account-1');
    expect(sentBody).toMatchObject({
      model: 'gpt-5.4',
      instructions: 'Project instructions',
      store: false,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
    });
    expect(sentBody).not.toHaveProperty('temperature');
  });

  it('removes blank Responses input item ids before Codex validates the request', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      obtainedAt: Date.now(),
      accountId: 'account-1',
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const authenticatedFetch = createOAuthAuthenticatedFetch('codex-oauth', {
      fetchImpl,
      loadCredential: () => credential,
      refreshStatus: vi.fn(),
    });

    await authenticatedFetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: [
          { id: 'msg_1', role: 'user', content: [{ type: 'input_text', text: 'First' }] },
          { id: '', role: 'assistant', content: [{ type: 'output_text', text: 'Second' }] },
        ],
      }),
    });

    const sentBody = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(sentBody.input[0].id).toBe('msg_1');
    expect(sentBody.input[1]).not.toHaveProperty('id');
  });
});
