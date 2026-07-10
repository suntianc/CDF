import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storeGetMock, storeSetMock, encryptSecretMock, decryptSecretMock } = vi.hoisted(() => ({
  storeGetMock: vi.fn(),
  storeSetMock: vi.fn(),
  encryptSecretMock: vi.fn(() => 'encrypted-value'),
  decryptSecretMock: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
}));

vi.mock('./store', () => ({
  default: { get: storeGetMock, set: storeSetMock },
}));

vi.mock('./security', () => ({
  encryptApiKey: encryptSecretMock,
  decryptApiKey: decryptSecretMock,
}));

import {
  clearSubscriptionSecret,
  getOAuthCredential,
  getSubscriptionSecret,
  markOAuthCredentialTerminalIfCurrent,
  setOAuthCredential,
  setSubscriptionSecret,
} from './ai-subscription-credentials';

describe('AI subscription credential vault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockReturnValue({});
  });

  it('encrypts a subscription credential at rest and decrypts it only on main-process read', () => {
    decryptSecretMock.mockReturnValueOnce('sk-secret');
    setSubscriptionSecret('minimax-token-plan', 'sk-secret');

    expect(encryptSecretMock).toHaveBeenCalledWith('sk-secret');
    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptionSecrets', {
      'minimax-token-plan': 'safe-storage:v1:encrypted-value',
    });
    expect(JSON.stringify(storeSetMock.mock.calls)).not.toContain('sk-secret');
    expect(storeSetMock).not.toHaveBeenCalledWith('aiSubscriptions', expect.anything());

    storeGetMock.mockReturnValue({ 'minimax-token-plan': 'safe-storage:v1:encrypted-value' });
    expect(getSubscriptionSecret('minimax-token-plan')).toBe('sk-secret');
    expect(decryptSecretMock).toHaveBeenCalledWith('encrypted-value');
  });

  it('migrates a legacy plaintext MiniMax key to encrypted storage when it is read', () => {
    storeGetMock.mockReturnValue({ 'minimax-token-plan': 'sk-legacy-key' });

    expect(getSubscriptionSecret('minimax-token-plan')).toBe('sk-legacy-key');
    expect(encryptSecretMock).toHaveBeenCalledWith('sk-legacy-key');
    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptionSecrets', {
      'minimax-token-plan': 'safe-storage:v1:encrypted-value',
    });
    expect(decryptSecretMock).not.toHaveBeenCalled();
  });

  it('stores and restores a structured Codex OAuth credential without persisting plaintext tokens', () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'codex-access-secret',
      refreshToken: 'codex-refresh-secret',
      tokenType: 'Bearer',
      expiresAt: 1_800_000_000_000,
      obtainedAt: 1_799_996_400_000,
      accountId: 'account-1',
      email: 'user@example.com',
    };

    setOAuthCredential('codex-oauth', credential);

    expect(encryptSecretMock).toHaveBeenCalledWith(JSON.stringify(credential));
    expect(JSON.stringify(storeSetMock.mock.calls)).not.toContain('codex-access-secret');
    expect(JSON.stringify(storeSetMock.mock.calls)).not.toContain('codex-refresh-secret');

    decryptSecretMock.mockReturnValueOnce(JSON.stringify(credential));
    storeGetMock.mockReturnValue({
      'codex-oauth': 'safe-storage:v1:encrypted-value',
    });
    expect(getOAuthCredential('codex-oauth')).toEqual(credential);
  });

  it('marks an unchanged OAuth credential with a persistent entitlement terminal state', () => {
    const credential = {
      kind: 'oauth' as const,
      accessToken: 'xai-access-token',
      refreshToken: 'xai-refresh-token',
      obtainedAt: 1_800_000_000_000,
    };
    decryptSecretMock.mockReturnValue(JSON.stringify(credential));
    storeGetMock.mockReturnValue({
      'xai-oauth': 'safe-storage:v1:encrypted-value',
    });

    const marked = markOAuthCredentialTerminalIfCurrent(
      'xai-oauth',
      credential,
      'unavailable',
      'xai_entitlement_denied'
    );

    expect(marked).toBe(true);
    expect(encryptSecretMock).toHaveBeenCalledWith(JSON.stringify({
      ...credential,
      terminalStatus: 'unavailable',
      terminalReason: 'xai_entitlement_denied',
    }));
  });

  it('does not quarantine a credential that rotated after the rejected request began', () => {
    const rejectedCredential = {
      kind: 'oauth' as const,
      accessToken: 'stale-access-token',
      refreshToken: 'stale-refresh-token',
      obtainedAt: 1_800_000_000_000,
    };
    decryptSecretMock.mockReturnValue(JSON.stringify({
      ...rejectedCredential,
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      obtainedAt: 1_800_000_001_000,
    }));
    storeGetMock.mockReturnValue({
      'xai-oauth': 'safe-storage:v1:encrypted-value',
    });

    const marked = markOAuthCredentialTerminalIfCurrent(
      'xai-oauth',
      rejectedCredential,
      'unavailable',
      'xai_entitlement_denied'
    );

    expect(marked).toBe(false);
    expect(storeSetMock).not.toHaveBeenCalled();
  });

  it('does not recreate a credential cleared while an entitlement request was in flight', () => {
    const rejectedCredential = {
      kind: 'oauth' as const,
      accessToken: 'removed-access-token',
      refreshToken: 'removed-refresh-token',
      obtainedAt: 1_800_000_000_000,
    };
    storeGetMock.mockReturnValue({});

    const marked = markOAuthCredentialTerminalIfCurrent(
      'xai-oauth',
      rejectedCredential,
      'unavailable',
      'xai_entitlement_denied'
    );

    expect(marked).toBe(false);
    expect(storeSetMock).not.toHaveBeenCalled();
  });

  it('reads back a stored secret for the same entry', () => {
    storeGetMock.mockReturnValue({ 'minimax-token-plan': 'sk-key' });

    expect(getSubscriptionSecret('minimax-token-plan')).toBe('sk-key');
  });

  it('clears only the target entry secret and leaves siblings intact', () => {
    // Vault may still hold legacy keys from removed OAuth providers.
    storeGetMock.mockReturnValue({ 'minimax-token-plan': 'a', 'legacy-oauth': 'b' });

    clearSubscriptionSecret('minimax-token-plan');

    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptionSecrets', { 'legacy-oauth': 'b' });
  });

  it('tolerates a corrupt or missing secret record without throwing', () => {
    storeGetMock.mockReturnValue(undefined);
    expect(getSubscriptionSecret('minimax-token-plan')).toBeUndefined();

    storeGetMock.mockReturnValue('not-an-object');
    expect(getSubscriptionSecret('minimax-token-plan')).toBeUndefined();
  });
});
