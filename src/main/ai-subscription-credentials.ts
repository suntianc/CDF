import store from './store';
import type { AISubscriptionEntryId } from '../shared/ai-subscriptions';
import { decryptApiKey, encryptApiKey } from './security';

// Credential Vault: subscription secrets (subscription keys, OAuth tokens) live
// in the main process under a namespace that is never exposed through IPC or the
// renderer-facing read model. Keep every read/write of secrets in this module.
const SECRET_STORE_KEY = 'aiSubscriptionSecrets';
const ENCRYPTED_SECRET_PREFIX = 'safe-storage:v1:';

type SecretRecord = Partial<Record<AISubscriptionEntryId, string>>;
type OAuthSubscriptionEntryId = Extract<AISubscriptionEntryId, 'codex-oauth' | 'xai-oauth'>;
export type OAuthCredentialTerminalStatus = 'expired' | 'unavailable';
export type OAuthCredentialTerminalReason = 'xai_entitlement_denied';

export interface OAuthCredential {
  kind: 'oauth';
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresAt?: number;
  obtainedAt: number;
  accountId?: string;
  email?: string;
  tokenEndpoint?: string;
  /** Terminal auth failure marker; retained so dead rotating tokens stay quarantined across restarts. */
  terminalStatus?: OAuthCredentialTerminalStatus;
  /** Main-process-only reason for terminal states that cannot be healed by token refresh. */
  terminalReason?: OAuthCredentialTerminalReason;
}

function readSecrets(): SecretRecord {
  const value = store.get(SECRET_STORE_KEY) as SecretRecord | undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

export function setSubscriptionSecret(entryId: AISubscriptionEntryId, secret: string): void {
  const encrypted = `${ENCRYPTED_SECRET_PREFIX}${encryptApiKey(secret)}`;
  store.set(SECRET_STORE_KEY, { ...readSecrets(), [entryId]: encrypted });
}

export function getSubscriptionSecret(entryId: AISubscriptionEntryId): string | undefined {
  const stored = readSecrets()[entryId];
  if (!stored) return undefined;
  if (!stored.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    setSubscriptionSecret(entryId, stored);
    return stored;
  }
  return decryptApiKey(stored.slice(ENCRYPTED_SECRET_PREFIX.length));
}

export function clearSubscriptionSecret(entryId: AISubscriptionEntryId): void {
  const next = { ...readSecrets() };
  delete next[entryId];
  store.set(SECRET_STORE_KEY, next);
}

export function setOAuthCredential(
  entryId: OAuthSubscriptionEntryId,
  credential: OAuthCredential
): void {
  const encrypted = `${ENCRYPTED_SECRET_PREFIX}${encryptApiKey(JSON.stringify(credential))}`;
  store.set(SECRET_STORE_KEY, { ...readSecrets(), [entryId]: encrypted });
}

export function getOAuthCredential(
  entryId: OAuthSubscriptionEntryId
): OAuthCredential | undefined {
  const stored = readSecrets()[entryId];
  if (!stored?.startsWith(ENCRYPTED_SECRET_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(
      decryptApiKey(stored.slice(ENCRYPTED_SECRET_PREFIX.length))
    ) as Partial<OAuthCredential>;
    if (parsed.kind !== 'oauth' || typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
      return undefined;
    }
    if (typeof parsed.obtainedAt !== 'number') return undefined;
    return parsed as OAuthCredential;
  } catch {
    return undefined;
  }
}

function credentialVersionMatches(left: OAuthCredential, right: OAuthCredential): boolean {
  return left.accessToken === right.accessToken
    && left.refreshToken === right.refreshToken
    && left.obtainedAt === right.obtainedAt;
}

export function markOAuthCredentialTerminalIfCurrent(
  entryId: OAuthSubscriptionEntryId,
  expectedCredential: OAuthCredential,
  terminalStatus: OAuthCredentialTerminalStatus,
  terminalReason?: OAuthCredentialTerminalReason
): boolean {
  const current = getOAuthCredential(entryId);
  if (!current || !credentialVersionMatches(current, expectedCredential)) return false;
  setOAuthCredential(entryId, {
    ...current,
    terminalStatus,
    ...(terminalReason ? { terminalReason } : {}),
  });
  return true;
}
