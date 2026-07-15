/**
 * Canonical agent-slug helpers.
 *
 * Slugs are the stable `task(name: ...)` delegation keys consumed
 * by `createDeepAgentRuntime` (see `runtime.ts:583-584` —
 * `agentRow.slug || generateSlug(agentRow.name)`). They were
 * historically defined in 4 places (database.ts, runtime.ts,
 * agent-tools.ts × 2); this module consolidates the contract.
 *
 * `generateSlug(name)` handles normalization, while
 * `resolveAgentSlug(row)` reads the stable persisted delegation key.
 * Global uniqueness and reserved identities belong to Agent Catalog;
 * callers must never invent a suffixed key on conflict.
 */

import { generateAgentSlug } from '../../shared/agents';

/**
 * Slugify a human-readable name. Lower-cased, non-alphanumeric
 * runs collapsed to `-`, leading/trailing dashes trimmed, capped
 * at 50 chars to keep `task(name: ...)` keys reasonable.
 */
export function generateSlug(name: string): string {
  return generateAgentSlug(name);
}

interface SlugSource {
  slug?: string | null;
  name: string;
}

/**
 * Resolve the effective slug for a row — what the runtime would
 * use as the subagent's task(name:) key. Falls back to
 * `generateSlug(name)` when the persisted slug is null/empty,
 * matching runtime.ts:584.
 */
export function resolveAgentSlug(row: SlugSource): string {
  return row.slug || generateSlug(row.name);
}
