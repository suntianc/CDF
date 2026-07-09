import store from './store';
import type { AISubscriptionEntryId } from '../shared/ai-subscriptions';

// Credential Vault: subscription secrets (subscription keys, OAuth tokens) live
// in the main process under a namespace that is never exposed through IPC or the
// renderer-facing read model. Keep every read/write of secrets in this module.
const SECRET_STORE_KEY = 'aiSubscriptionSecrets';

type SecretRecord = Partial<Record<AISubscriptionEntryId, string>>;

function readSecrets(): SecretRecord {
  const value = store.get(SECRET_STORE_KEY) as SecretRecord | undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

export function setSubscriptionSecret(entryId: AISubscriptionEntryId, secret: string): void {
  store.set(SECRET_STORE_KEY, { ...readSecrets(), [entryId]: secret });
}

export function getSubscriptionSecret(entryId: AISubscriptionEntryId): string | undefined {
  return readSecrets()[entryId];
}

export function clearSubscriptionSecret(entryId: AISubscriptionEntryId): void {
  const next = { ...readSecrets() };
  delete next[entryId];
  store.set(SECRET_STORE_KEY, next);
}
