import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storeGetMock, storeSetMock } = vi.hoisted(() => ({
  storeGetMock: vi.fn(),
  storeSetMock: vi.fn(),
}));

vi.mock('./store', () => ({
  default: { get: storeGetMock, set: storeSetMock },
}));

import {
  clearSubscriptionSecret,
  getSubscriptionSecret,
  setSubscriptionSecret,
} from './ai-subscription-credentials';

describe('AI subscription credential vault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockReturnValue({});
  });

  it('stores secrets under a dedicated namespace, never the renderer-facing subscription state', () => {
    setSubscriptionSecret('minimax-token-plan', 'sk-secret');

    expect(storeSetMock).toHaveBeenCalledWith('aiSubscriptionSecrets', { 'minimax-token-plan': 'sk-secret' });
    expect(storeSetMock).not.toHaveBeenCalledWith('aiSubscriptions', expect.anything());
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
