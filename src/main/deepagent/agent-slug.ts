/**
 * Canonical agent-slug helpers.
 *
 * Slugs are the stable `task(name: ...)` delegation keys consumed
 * by `createDeepAgentRuntime` (see `runtime.ts:583-584` —
 * `agentRow.slug || generateSlug(agentRow.name)`). They were
 * historically defined in 4 places (database.ts, runtime.ts,
 * agent-tools.ts × 2); this module consolidates the contract.
 *
 * Three functions:
 *
 *   1. `generateSlug(name)` — pure regex-based normalization.
 *
 *   2. `resolveAgentSlug(row)` — given a persisted row, return the
 *      effective slug the runtime will use. Matches the
 *      `row.slug || generateSlug(row.name)` fallback chain.
 *
 *   3. `ensureUniqueSlug(projectId, baseSlug, now?)` — query the
 *      agents table for the project (including legacy rows with
 *      `slug IS NULL` or `slug = ''`), project each row's effective
 *      slug into a `taken` set, and return a unique slug by
 *      appending `-2`, `-3`, ... . Must be called inside a
 *      `db.transaction(() => { ... })` block so the read-then-
 *      write is atomic (better-sqlite3 is single-writer; the tx is
 *      the synchronization point).
 */

import db from '../database';

/**
 * Slugify a human-readable name. Lower-cased, non-alphanumeric
 * runs collapsed to `-`, leading/trailing dashes trimmed, capped
 * at 50 chars to keep `task(name: ...)` keys reasonable.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

interface SlugSource {
  slug: string | null | undefined;
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

/**
 * Project-scoped unique-slug resolver.
 *
 * Reads every agents row in the project whose persisted slug
 * (or, for NULL/empty-slug legacy rows, generated-from-name
 * effective slug) would collide with `baseSlug`, and returns a
 * slug that does not collide. Appends `-2`, `-3`, ... until
 * free; after 1000 attempts falls back to `${baseSlug}-${now}`
 * (defensive — never expected to trigger in practice).
 *
 * Caller MUST invoke this inside a `db.transaction(() => { ... })`
 * block so the read-then-write is serialized against concurrent
 * inserts.
 */
export function ensureUniqueSlug(
  projectId: string,
  baseSlug: string,
  now: number = Date.now(),
): string {
  // Match persisted slugs (exact or `-N` suffix) AND legacy
  // NULL/empty-slug rows whose effective slug would otherwise be
  // invisible to the persisted-slug check. PR #5 review (suntianc
  // 2026-06-09): "slug 查重会漏掉 slug IS NULL 的旧 agent".
  const rows = db
    .prepare(
      'SELECT id, slug, name FROM agents ' +
        'WHERE project_id = ? ' +
        'AND (slug = ? OR slug LIKE ? OR slug IS NULL OR slug = ?)',
    )
    .all(projectId, baseSlug, `${baseSlug}-%`, '') as Array<{
      id: string;
      slug: string | null;
      name: string;
    }>;

  const taken = new Set<string>();
  for (const r of rows) {
    taken.add(resolveAgentSlug(r));
  }

  if (!taken.has(baseSlug)) return baseSlug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseSlug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${baseSlug}-${now}`;
}
