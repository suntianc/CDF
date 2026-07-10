import { describe, expect, it, vi } from 'vitest';
import {
  connectMiniMaxTokenPlan,
  createCodexOAuthAdapter,
  createXaiOAuthAdapter,
} from './ai-subscription-adapters';
import type { OAuthCredential } from './ai-subscription-credentials';

describe('MiniMax Token Plan adapter', () => {
  it('requests token-plan remains with the subscription key as a Bearer credential and reports connected', async () => {
    const httpGetJson = vi.fn().mockResolvedValue({ status: 200, body: {} });

    const result = await connectMiniMaxTokenPlan('sk-minimax-test', { httpGetJson });

    expect(httpGetJson).toHaveBeenCalledWith(
      'https://www.minimaxi.com/v1/token_plan/remains',
      { Authorization: 'Bearer sk-minimax-test', 'Content-Type': 'application/json' }
    );
    expect(result.status).toBe('connected');
  });

  it('normalizes the remains response into weekly and 5-hour usage summaries', async () => {
    // NOTE: remains response schema is not publicly documented; this fixture is
    // a provisional shape. If the real API differs, update the fixture + the
    // normalizer together — the rest of the pipeline asserts only on the
    // normalized AISubscriptionUsageSummary output below.
    const httpGetJson = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        token_plan: {
          weekly: { total: 500_000, used: 120_000 },
          five_hour: { total: 100_000, used: 8_000 },
        },
      },
    });

    const result = await connectMiniMaxTokenPlan('sk-minimax-test', { httpGetJson });

    expect(result.usageSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: 'weekly', used: 120_000, limit: 500_000, remaining: 380_000 }),
      expect.objectContaining({ period: 'five_hour', used: 8_000, limit: 100_000, remaining: 92_000 }),
    ]));
  });

  it('marks an unauthorized subscription key as expired instead of connected', async () => {
    const httpGetJson = vi.fn().mockResolvedValue({ status: 401, body: {} });

    const result = await connectMiniMaxTokenPlan('sk-bad-key', { httpGetJson });

    expect(result.status).toBe('expired');
  });

  it('marks a failed remains request as unavailable rather than connected', async () => {
    const httpGetJson = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await connectMiniMaxTokenPlan('sk-minimax-test', { httpGetJson });

    expect(result.status).toBe('unavailable');
  });
});

describe('Codex OAuth adapter', () => {
  it('starts the private device flow with a renderer-safe login descriptor', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        user_code: 'ABCD-1234',
        device_auth_id: 'private-device-auth-id',
        interval: 5,
      },
      headers: {},
    });
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential: vi.fn(),
    });

    const result = await adapter.startLogin();

    expect(result).toEqual({
      status: 'connecting',
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: 1_800_000_900_000,
        pollIntervalMs: 5_000,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-device-auth-id');
    expect(JSON.stringify(result)).not.toMatch(/access.?token|refresh.?token|code.?verifier/i);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
      body: { client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' },
      headers: expect.objectContaining({ 'User-Agent': 'cdf/1.0.0' }),
    }));
  });

  it('exchanges an authorized Codex device session and saves tokens only in the vault', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: {
          user_code: 'ABCD-1234',
          device_auth_id: 'private-device-auth-id',
          interval: 5,
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          authorization_code: 'private-authorization-code',
          code_verifier: 'private-code-verifier',
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          access_token: 'codex-access-secret',
          refresh_token: 'codex-refresh-secret',
          expires_in: 3_600,
          token_type: 'Bearer',
        },
        headers: {},
      });
    const saveCredential = vi.fn();
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();

    const result = await adapter.pollLoginStatus(start.descriptor.attemptId);

    expect(result).toEqual({ status: 'connected' });
    expect(JSON.stringify(result)).not.toMatch(/codex-access-secret|codex-refresh-secret/);
    expect(saveCredential).toHaveBeenCalledWith('codex-oauth', {
      kind: 'oauth',
      accessToken: 'codex-access-secret',
      refreshToken: 'codex-refresh-secret',
      tokenType: 'Bearer',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'POST',
      url: 'https://auth.openai.com/api/accounts/deviceauth/token',
      body: {
        device_auth_id: 'private-device-auth-id',
        user_code: 'ABCD-1234',
      },
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: 'POST',
      url: 'https://auth.openai.com/oauth/token',
      body: expect.objectContaining({
        grant_type: 'authorization_code',
        code: 'private-authorization-code',
        code_verifier: 'private-code-verifier',
        redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      }),
    }));
  });

  it('keeps a Codex device attempt pollable after a transient network failure', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { user_code: 'ABCD-1234', device_auth_id: 'device-1', interval: 5 },
        headers: {},
      })
      .mockRejectedValueOnce(new Error('temporary network failure'));
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential: vi.fn(),
    });
    const start = await adapter.startLogin();

    await expect(adapter.pollLoginStatus(start.descriptor.attemptId)).resolves.toEqual({
      status: 'connecting',
      nextPollAfterMs: 5_000,
    });
  });

  it('retries a rate-limited Codex user-code request using Retry-After', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 429,
        body: { error: 'rate_limited' },
        headers: { 'retry-after': '2' },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          user_code: 'ABCD-1234',
          device_auth_id: 'private-device-auth-id',
          interval: 5,
        },
        headers: {},
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential: vi.fn(),
      sleep,
    });

    const result = await adapter.startLogin();

    expect(result.status).toBe('connecting');
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('captures Codex account metadata from login tokens for account-scoped requests', async () => {
    const accessToken = `header.${Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-1',
      },
    })).toString('base64url')}.signature`;
    const idToken = `header.${Buffer.from(JSON.stringify({
      email: 'user@example.com',
    })).toString('base64url')}.signature`;
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { user_code: 'ABCD-1234', device_auth_id: 'device-1', interval: 5 },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { authorization_code: 'code-1', code_verifier: 'verifier-1' },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          access_token: accessToken,
          refresh_token: 'refresh-token',
          id_token: idToken,
          expires_in: 3_600,
        },
        headers: {},
      });
    const saveCredential = vi.fn();
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();

    await adapter.pollLoginStatus(start.descriptor.attemptId);

    expect(saveCredential).toHaveBeenCalledWith('codex-oauth', expect.objectContaining({
      accountId: 'account-1',
      email: 'user@example.com',
      idToken,
    }));
  });

  it('refreshes an expiring Codex credential and persists the rotated refresh token', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3_600,
        token_type: 'Bearer',
      },
      headers: {},
    });
    const saveCredential = vi.fn();
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => ({
        kind: 'oauth',
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        tokenType: 'Bearer',
        expiresAt: 1_799_999_999_000,
        obtainedAt: 1_799_996_400_000,
      }),
      saveCredential,
    });

    const result = await adapter.refreshStatus();

    expect(result).toEqual({ status: 'connected' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://auth.openai.com/oauth/token',
      body: {
        grant_type: 'refresh_token',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        refresh_token: 'old-refresh-token',
      },
    }));
    expect(saveCredential).toHaveBeenCalledWith('codex-oauth', {
      kind: 'oauth',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'Bearer',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
    });
  });

  it('reports Codex 5-hour and weekly usage from the ChatGPT account endpoint', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 35, reset_at: '2027-01-15T10:00:00Z' },
          secondary_window: { used_percent: 12, reset_at: '2027-01-20T10:00:00Z' },
        },
      },
      headers: {},
    });
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => ({
        kind: 'oauth',
        accessToken: 'codex-access-token',
        refreshToken: 'codex-refresh-token',
        expiresAt: 1_800_003_600_000,
        obtainedAt: 1_800_000_000_000,
        accountId: 'account-1',
      }),
      saveCredential: vi.fn(),
    });

    const result = await adapter.refreshStatus();

    expect(result).toEqual({
      status: 'connected',
      usageSummaries: [
        {
          period: 'five_hour',
          label: '5-hour quota',
          used: 35,
          limit: 100,
          remaining: 65,
          resetsAt: Date.parse('2027-01-15T10:00:00Z'),
        },
        {
          period: 'weekly',
          label: 'Weekly quota',
          used: 12,
          limit: 100,
          remaining: 88,
          resetsAt: Date.parse('2027-01-20T10:00:00Z'),
        },
      ],
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: expect.objectContaining({
        Authorization: 'Bearer codex-access-token',
        'ChatGPT-Account-Id': 'account-1',
      }),
    }));
  });

  it('single-flights concurrent Codex refreshes so its rotating token is consumed once', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'old-access-token',
      refreshToken: 'single-use-refresh-token',
      expiresAt: 1_799_999_999_000,
      obtainedAt: 1_799_996_400_000,
    };
    const request = vi.fn().mockImplementation(async (input) => {
      if ((input.body as Record<string, unknown> | undefined)?.grant_type === 'refresh_token') {
        return {
          status: 200,
          body: {
            access_token: 'new-access-token',
            refresh_token: 'rotated-refresh-token',
            expires_in: 3_600,
          },
          headers: {},
        };
      }
      return { status: 503, body: {}, headers: {} };
    });
    const saveCredential = vi.fn();
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential,
    });

    const [first, second] = await Promise.all([
      adapter.refreshStatus(),
      adapter.refreshStatus(),
    ]);

    expect(first).toEqual({ status: 'connected' });
    expect(second).toEqual({ status: 'connected' });
    const refreshRequests = request.mock.calls.filter(([input]) =>
      (input.body as Record<string, unknown> | undefined)?.grant_type === 'refresh_token'
    );
    expect(refreshRequests).toHaveLength(1);
    expect(saveCredential).toHaveBeenCalledTimes(1);
  });

  it('does not restore a Codex credential when disconnect wins an in-flight refresh', async () => {
    let credential: OAuthCredential | undefined = {
      kind: 'oauth' as const,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: 1_799_999_999_000,
      obtainedAt: 1_799_996_400_000,
    };
    let resolveRefresh!: (value: unknown) => void;
    const refreshResponse = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const saveCredential = vi.fn((_entryId, nextCredential) => {
      credential = nextCredential;
    });
    const adapter = createCodexOAuthAdapter({
      request: vi.fn(() => refreshResponse),
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential,
    });

    const refreshing = adapter.refreshStatus({ force: true });
    credential = undefined;
    resolveRefresh({
      status: 200,
      body: { access_token: 'late-access-token', refresh_token: 'late-refresh-token', expires_in: 3_600 },
      headers: {},
    });

    await expect(refreshing).resolves.toEqual({ status: 'logged_out' });
    expect(saveCredential).not.toHaveBeenCalled();
    expect(credential).toBeUndefined();
  });

  it('quarantines a terminal Codex refresh failure instead of retrying the dead token', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth' as const,
      accessToken: 'rejected-access-token',
      refreshToken: 'consumed-refresh-token',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
    };
    const request = vi.fn().mockResolvedValue({
      status: 400,
      body: { error: { type: 'refresh_token_reused' } },
      headers: {},
    });
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    await expect(adapter.refreshStatus({ force: true })).resolves.toEqual({ status: 'expired' });
    await expect(adapter.refreshStatus()).resolves.toEqual({ status: 'expired' });
    expect(credential.terminalStatus).toBe('expired');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not let an in-flight Codex usage refresh swallow a forced token refresh', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
    };
    let resolveUsage!: (value: unknown) => void;
    const usageResponse = new Promise((resolve) => {
      resolveUsage = resolve;
    });
    const request = vi.fn().mockImplementation((input) => {
      if (input.method === 'GET') return usageResponse;
      return Promise.resolve({
        status: 200,
        body: { access_token: 'fresh-access-token', refresh_token: 'rotated-refresh-token', expires_in: 3_600 },
        headers: {},
      });
    });
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    const statusRefresh = adapter.refreshStatus();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const forcedRefresh = adapter.refreshStatus({ force: true, includeUsage: false });
    resolveUsage({ status: 200, body: {}, headers: {} });

    await expect(statusRefresh).resolves.toEqual({ status: 'connected' });
    await expect(forcedRefresh).resolves.toEqual({ status: 'connected' });
    expect(credential.accessToken).toBe('fresh-access-token');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('coalesces forced Codex refreshes waiting behind an in-flight usage refresh', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
    };
    let resolveUsage!: (value: unknown) => void;
    const usageResponse = new Promise((resolve) => {
      resolveUsage = resolve;
    });
    const request = vi.fn().mockImplementation((input) => {
      if (input.method === 'GET') return usageResponse;
      return Promise.resolve({
        status: 200,
        body: { access_token: 'fresh-access-token', refresh_token: 'rotated-refresh-token', expires_in: 3_600 },
        headers: {},
      });
    });
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    const statusRefresh = adapter.refreshStatus();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const firstForcedRefresh = adapter.refreshStatus({ force: true, includeUsage: false });
    const secondForcedRefresh = adapter.refreshStatus({ force: true, includeUsage: false });
    resolveUsage({ status: 200, body: {}, headers: {} });

    await expect(Promise.all([
      statusRefresh,
      firstForcedRefresh,
      secondForcedRefresh,
    ])).resolves.toEqual([
      { status: 'connected' },
      { status: 'connected' },
      { status: 'connected' },
    ]);
    expect(request.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
  });

  it('does not save a late Codex token exchange after the login attempt is cancelled', async () => {
    let resolveTokenResponse!: (value: unknown) => void;
    const tokenResponse = new Promise((resolve) => {
      resolveTokenResponse = resolve;
    });
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { user_code: 'ABCD-1234', device_auth_id: 'device-1', interval: 5 },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { authorization_code: 'code-1', code_verifier: 'verifier-1' },
        headers: {},
      })
      .mockImplementationOnce(() => tokenResponse);
    const saveCredential = vi.fn();
    const adapter = createCodexOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();
    const pollPromise = adapter.pollLoginStatus(start.descriptor.attemptId);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    await adapter.cancelLogin(start.descriptor.attemptId);
    resolveTokenResponse({
      status: 200,
      body: {
        access_token: 'late-access-token',
        refresh_token: 'late-refresh-token',
      },
      headers: {},
    });

    await expect(pollPromise).resolves.toEqual({ status: 'logged_out', reason: 'cancelled' });
    expect(saveCredential).not.toHaveBeenCalled();
  });
});

describe('xAI Grok OAuth adapter', () => {
  it('starts the standard device grant with a renderer-safe descriptor', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: {
          authorization_endpoint: 'https://auth.x.ai/oauth2/authorize',
          token_endpoint: 'https://auth.x.ai/oauth2/token',
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          device_code: 'private-xai-device-code',
          user_code: 'WXYZ-9876',
          verification_uri: 'https://auth.x.ai/activate',
          verification_uri_complete: 'https://auth.x.ai/activate?user_code=WXYZ-9876',
          expires_in: 900,
          interval: 5,
        },
        headers: {},
      });
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      saveCredential: vi.fn(),
    });

    const result = await adapter.startLogin();

    expect(result).toEqual({
      status: 'connecting',
      descriptor: {
        attemptId: 'xai-attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.x.ai/activate?user_code=WXYZ-9876',
        userCode: 'WXYZ-9876',
        expiresAt: 1_800_000_900_000,
        pollIntervalMs: 5_000,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private-xai-device-code');
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'GET',
      url: 'https://auth.x.ai/.well-known/openid-configuration',
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'POST',
      url: 'https://auth.x.ai/oauth2/device/code',
      body: expect.objectContaining({
        client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
        scope: 'openid profile email offline_access grok-cli:access api:access',
      }),
    }));
  });

  it('polls an authorized xAI device grant and stores the OAuth tokens', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { token_endpoint: 'https://auth.x.ai/oauth2/token' },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          device_code: 'private-xai-device-code',
          user_code: 'WXYZ-9876',
          verification_uri: 'https://auth.x.ai/activate',
          expires_in: 900,
          interval: 5,
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          access_token: 'xai-access-token',
          refresh_token: 'xai-refresh-token',
          id_token: 'xai-id-token',
          expires_in: 900,
          token_type: 'Bearer',
        },
        headers: {},
      });
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();

    const result = await adapter.pollLoginStatus(start.descriptor.attemptId);

    expect(result).toEqual({ status: 'connected' });
    expect(saveCredential).toHaveBeenCalledWith('xai-oauth', {
      kind: 'oauth',
      accessToken: 'xai-access-token',
      refreshToken: 'xai-refresh-token',
      idToken: 'xai-id-token',
      tokenType: 'Bearer',
      expiresAt: 1_800_000_900_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    });
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: 'POST',
      url: 'https://auth.x.ai/oauth2/token',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
        device_code: 'private-xai-device-code',
      },
    }));
  });

  it('keeps an xAI device attempt pollable after a transient network failure', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { token_endpoint: 'https://auth.x.ai/oauth2/token' },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          device_code: 'private-device-code',
          user_code: 'WXYZ-9876',
          verification_uri: 'https://auth.x.ai/activate',
          expires_in: 900,
          interval: 5,
        },
        headers: {},
      })
      .mockRejectedValueOnce(new Error('temporary network failure'));
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      saveCredential: vi.fn(),
    });
    const start = await adapter.startLogin();

    await expect(adapter.pollLoginStatus(start.descriptor.attemptId)).resolves.toEqual({
      status: 'connecting',
      nextPollAfterMs: 5_000,
    });
  });

  it('honors xAI slow_down and keeps authorization_pending in connecting state', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { token_endpoint: 'https://auth.x.ai/oauth2/token' },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          device_code: 'private-xai-device-code',
          user_code: 'WXYZ-9876',
          verification_uri: 'https://auth.x.ai/activate',
          expires_in: 900,
          interval: 5,
        },
        headers: {},
      })
      .mockResolvedValueOnce({ status: 400, body: { error: 'slow_down' }, headers: {} })
      .mockResolvedValueOnce({ status: 400, body: { error: 'authorization_pending' }, headers: {} });
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();

    await expect(adapter.pollLoginStatus(start.descriptor.attemptId)).resolves.toEqual({
      status: 'connecting',
      nextPollAfterMs: 6_000,
    });
    await expect(adapter.pollLoginStatus(start.descriptor.attemptId)).resolves.toEqual({
      status: 'connecting',
      nextPollAfterMs: 6_000,
    });
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it('does not save a late xAI token response after the login attempt is cancelled', async () => {
    let resolveTokenResponse!: (value: unknown) => void;
    const tokenResponse = new Promise((resolve) => {
      resolveTokenResponse = resolve;
    });
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { token_endpoint: 'https://auth.x.ai/oauth2/token' },
        headers: {},
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          device_code: 'private-xai-device-code',
          user_code: 'WXYZ-9876',
          verification_uri: 'https://auth.x.ai/activate',
          expires_in: 900,
          interval: 5,
        },
        headers: {},
      })
      .mockImplementationOnce(() => tokenResponse);
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      saveCredential,
    });
    const start = await adapter.startLogin();
    const pollPromise = adapter.pollLoginStatus(start.descriptor.attemptId);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));

    await adapter.cancelLogin(start.descriptor.attemptId);
    resolveTokenResponse({
      status: 200,
      body: {
        access_token: 'late-access-token',
        refresh_token: 'late-refresh-token',
        expires_in: 900,
      },
      headers: {},
    });

    await expect(pollPromise).resolves.toEqual({ status: 'logged_out', reason: 'cancelled' });
    expect(saveCredential).not.toHaveBeenCalled();
  });

  it('refreshes a short-lived xAI credential near expiry and saves the rotated token chain', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        access_token: 'new-xai-access-token',
        refresh_token: 'new-xai-refresh-token',
        id_token: 'new-xai-id-token',
        expires_in: 900,
        token_type: 'Bearer',
      },
      headers: {},
    });
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      loadCredential: () => ({
        kind: 'oauth',
        accessToken: 'old-xai-access-token',
        refreshToken: 'old-xai-refresh-token',
        expiresAt: 1_800_000_060_000,
        obtainedAt: 1_799_999_160_000,
        tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      }),
      saveCredential,
    });

    const result = await adapter.refreshStatus();

    expect(result).toEqual({ status: 'connected' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://auth.x.ai/oauth2/token',
      body: {
        grant_type: 'refresh_token',
        client_id: 'b1a00492-073a-47ea-816f-4c329264a828',
        refresh_token: 'old-xai-refresh-token',
      },
    }));
    expect(saveCredential).toHaveBeenCalledWith('xai-oauth', {
      kind: 'oauth',
      accessToken: 'new-xai-access-token',
      refreshToken: 'new-xai-refresh-token',
      idToken: 'new-xai-id-token',
      expiresAt: 1_800_000_900_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      tokenType: 'Bearer',
    });
  });

  it('single-flights concurrent xAI refreshes so a rotating refresh token is consumed once', async () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'old-xai-access-token',
      refreshToken: 'single-use-refresh-token',
      expiresAt: 1_800_000_060_000,
      obtainedAt: 1_799_999_160_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    };
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        access_token: 'new-xai-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 900,
      },
      headers: {},
    });
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'xai-attempt-1',
      loadCredential: () => credential,
      saveCredential,
    });

    const [first, second] = await Promise.all([
      adapter.refreshStatus(),
      adapter.refreshStatus(),
    ]);

    expect(first).toEqual({ status: 'connected' });
    expect(second).toEqual({ status: 'connected' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(saveCredential).toHaveBeenCalledTimes(1);
  });

  it('does not let a fresh xAI status check swallow an immediately forced refresh', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_007_200_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    };
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: { access_token: 'fresh-access-token', refresh_token: 'rotated-refresh-token', expires_in: 900 },
      headers: {},
    });
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    const [statusResult, forcedResult] = await Promise.all([
      adapter.refreshStatus(),
      adapter.refreshStatus({ force: true }),
    ]);

    expect(statusResult).toEqual({ status: 'connected' });
    expect(forcedResult).toEqual({ status: 'connected' });
    expect(credential.accessToken).toBe('fresh-access-token');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('coalesces forced xAI refreshes waiting behind an in-flight status check', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_007_200_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    };
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: { access_token: 'fresh-access-token', refresh_token: 'rotated-refresh-token', expires_in: 900 },
      headers: {},
    });
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    const statusRefresh = adapter.refreshStatus();
    const firstForcedRefresh = adapter.refreshStatus({ force: true });
    const secondForcedRefresh = adapter.refreshStatus({ force: true });

    await expect(Promise.all([
      statusRefresh,
      firstForcedRefresh,
      secondForcedRefresh,
    ])).resolves.toEqual([
      { status: 'connected' },
      { status: 'connected' },
      { status: 'connected' },
    ]);
    expect(request.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
  });

  it('quarantines a terminal xAI refresh failure until the user reconnects', async () => {
    let credential: OAuthCredential = {
      kind: 'oauth',
      accessToken: 'rejected-access-token',
      refreshToken: 'rejected-refresh-token',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
    };
    const request = vi.fn().mockResolvedValue({ status: 401, body: {}, headers: {} });
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential: (_entryId, nextCredential) => {
        credential = nextCredential;
      },
    });

    await expect(adapter.refreshStatus({ force: true })).resolves.toEqual({ status: 'expired' });
    await expect(adapter.refreshStatus()).resolves.toEqual({ status: 'expired' });
    expect(credential.terminalStatus).toBe('expired');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps an entitlement-denied xAI credential unavailable without touching the token endpoint', async () => {
    const credential: OAuthCredential = {
      kind: 'oauth',
      accessToken: 'valid-but-unentitled-access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_003_600_000,
      obtainedAt: 1_800_000_000_000,
      tokenEndpoint: 'https://auth.x.ai/oauth2/token',
      terminalStatus: 'unavailable',
      terminalReason: 'xai_entitlement_denied',
    };
    const request = vi.fn();
    const saveCredential = vi.fn();
    const adapter = createXaiOAuthAdapter({
      request,
      now: () => 1_800_000_000_000,
      randomId: () => 'attempt-1',
      loadCredential: () => credential,
      saveCredential,
    });

    await expect(adapter.refreshStatus()).resolves.toEqual({ status: 'unavailable' });
    await expect(adapter.refreshStatus({ force: true })).resolves.toEqual({ status: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
    expect(saveCredential).not.toHaveBeenCalled();
  });
});
