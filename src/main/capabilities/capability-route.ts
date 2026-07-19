/**
 * Shared capability route resolver.
 *
 * The image/video/music/speech capabilities all expose a provider-neutral Agent
 * tool backed by one or more subscription providers. This pure function is the
 * single seam that decides which provider a request goes to, so the routing
 * contract lives (and is asserted) in one place instead of being re-implemented
 * per capability. It only consumes candidate availability — it never reads
 * global state — and it degenerates cleanly to a single-candidate list for the
 * capabilities that currently have only one provider.
 */

export type CapabilityRouteErrorCode = 'ROUTE_UNAVAILABLE' | 'CAPABILITY_DISABLED';

/**
 * A provider candidate for a capability. Candidates are supplied in priority
 * order (highest priority first).
 *
 * - `connected`: the provider route resolved and is usable (logged in, keyed).
 * - `operationEnabled`: the requested operation is switched on for this provider.
 * - `unavailableError` / `disabledError`: the exact messages to surface when
 *   this candidate is selected but not connected / connected but disabled.
 */
export interface CapabilityRouteCandidate<Id extends string> {
  id: Id;
  connected: boolean;
  operationEnabled: boolean;
  unavailableError: string;
  disabledError: string;
}

export type CapabilityRouteResolution<Id extends string> =
  | { ok: true; id: Id }
  | { ok: false; error: string; code: CapabilityRouteErrorCode };

/**
 * Resolve which provider handles a capability request.
 *
 * - Explicit hint: select that provider; fail `ROUTE_UNAVAILABLE` when it is not
 *   connected, `CAPABILITY_DISABLED` when connected but the operation is off.
 * - `auto`: pick the highest-priority candidate that is both connected and has
 *   the operation enabled; when none qualifies, report the highest-priority
 *   candidate's failure.
 */
export function resolveCapabilityRoute<Id extends string>(
  hint: Id | 'auto',
  candidates: CapabilityRouteCandidate<Id>[]
): CapabilityRouteResolution<Id> {
  if (candidates.length === 0) {
    return { ok: false, error: 'No capability route is configured', code: 'ROUTE_UNAVAILABLE' };
  }

  if (hint !== 'auto') {
    const selected = candidates.find((candidate) => candidate.id === hint);
    if (!selected) {
      return {
        ok: false,
        error: `Unsupported capability route: ${hint}`,
        code: 'ROUTE_UNAVAILABLE',
      };
    }
    return finalize(selected);
  }

  const available = candidates.find(
    (candidate) => candidate.connected && candidate.operationEnabled
  );
  if (available) return { ok: true, id: available.id };
  return finalize(candidates[0]);
}

function finalize<Id extends string>(
  candidate: CapabilityRouteCandidate<Id>
): CapabilityRouteResolution<Id> {
  if (!candidate.connected) {
    return { ok: false, error: candidate.unavailableError, code: 'ROUTE_UNAVAILABLE' };
  }
  if (!candidate.operationEnabled) {
    return { ok: false, error: candidate.disabledError, code: 'CAPABILITY_DISABLED' };
  }
  return { ok: true, id: candidate.id };
}
