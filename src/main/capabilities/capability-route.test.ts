import { describe, expect, it } from 'vitest';
import { resolveCapabilityRoute, type CapabilityRouteCandidate } from './capability-route';

type ImageRouteId = 'minimax-token-plan' | 'codex-oauth' | 'xai-oauth';

function candidate(
  id: ImageRouteId,
  connected: boolean,
  operationEnabled: boolean
): CapabilityRouteCandidate<ImageRouteId> {
  return {
    id,
    connected,
    operationEnabled,
    unavailableError: `${id} not connected`,
    disabledError: `${id} disabled`,
  };
}

describe('resolveCapabilityRoute', () => {
  it('auto picks the highest-priority connected+enabled candidate', () => {
    const result = resolveCapabilityRoute('auto', [
      candidate('minimax-token-plan', true, true),
      candidate('codex-oauth', true, true),
      candidate('xai-oauth', true, true),
    ]);
    expect(result).toEqual({ ok: true, id: 'minimax-token-plan' });
  });

  it('auto skips a disconnected candidate and picks the next enabled one', () => {
    const result = resolveCapabilityRoute('auto', [
      candidate('minimax-token-plan', false, false),
      candidate('codex-oauth', true, true),
      candidate('xai-oauth', true, true),
    ]);
    expect(result).toEqual({ ok: true, id: 'codex-oauth' });
  });

  it('auto skips a connected-but-disabled candidate and picks the next enabled one', () => {
    const result = resolveCapabilityRoute('auto', [
      candidate('minimax-token-plan', true, false),
      candidate('codex-oauth', false, false),
      candidate('xai-oauth', true, true),
    ]);
    expect(result).toEqual({ ok: true, id: 'xai-oauth' });
  });

  it('auto reports the highest-priority candidate ROUTE_UNAVAILABLE when nothing is available', () => {
    const result = resolveCapabilityRoute('auto', [
      candidate('minimax-token-plan', false, false),
      candidate('codex-oauth', true, false),
      candidate('xai-oauth', false, false),
    ]);
    expect(result).toEqual({
      ok: false,
      error: 'minimax-token-plan not connected',
      code: 'ROUTE_UNAVAILABLE',
    });
  });

  it('auto reports the highest-priority candidate CAPABILITY_DISABLED when it is connected but off', () => {
    const result = resolveCapabilityRoute('auto', [
      candidate('minimax-token-plan', true, false),
      candidate('codex-oauth', false, false),
    ]);
    expect(result).toEqual({
      ok: false,
      error: 'minimax-token-plan disabled',
      code: 'CAPABILITY_DISABLED',
    });
  });

  it('explicit hint selects that candidate even when a higher-priority one is available', () => {
    const result = resolveCapabilityRoute('xai-oauth', [
      candidate('minimax-token-plan', true, true),
      candidate('codex-oauth', true, true),
      candidate('xai-oauth', true, true),
    ]);
    expect(result).toEqual({ ok: true, id: 'xai-oauth' });
  });

  it('explicit hint fails ROUTE_UNAVAILABLE when the chosen candidate is not connected', () => {
    const result = resolveCapabilityRoute('codex-oauth', [
      candidate('minimax-token-plan', true, true),
      candidate('codex-oauth', false, false),
    ]);
    expect(result).toEqual({
      ok: false,
      error: 'codex-oauth not connected',
      code: 'ROUTE_UNAVAILABLE',
    });
  });

  it('explicit hint fails CAPABILITY_DISABLED when the chosen candidate is connected but off', () => {
    const result = resolveCapabilityRoute('codex-oauth', [
      candidate('minimax-token-plan', true, true),
      candidate('codex-oauth', true, false),
    ]);
    expect(result).toEqual({
      ok: false,
      error: 'codex-oauth disabled',
      code: 'CAPABILITY_DISABLED',
    });
  });

  it('degenerates to a single connected+enabled candidate', () => {
    const result = resolveCapabilityRoute('auto', [candidate('xai-oauth', true, true)]);
    expect(result).toEqual({ ok: true, id: 'xai-oauth' });
  });

  it('degenerates to a single candidate ROUTE_UNAVAILABLE', () => {
    const result = resolveCapabilityRoute('auto', [candidate('xai-oauth', false, false)]);
    expect(result).toEqual({
      ok: false,
      error: 'xai-oauth not connected',
      code: 'ROUTE_UNAVAILABLE',
    });
  });

  it('degenerates to a single candidate CAPABILITY_DISABLED', () => {
    const result = resolveCapabilityRoute('xai-oauth', [candidate('xai-oauth', true, false)]);
    expect(result).toEqual({
      ok: false,
      error: 'xai-oauth disabled',
      code: 'CAPABILITY_DISABLED',
    });
  });

  it('fails ROUTE_UNAVAILABLE when the hint names no known candidate', () => {
    const result = resolveCapabilityRoute('codex-oauth', [candidate('xai-oauth', true, true)]);
    expect(result).toEqual({
      ok: false,
      error: 'Unsupported capability route: codex-oauth',
      code: 'ROUTE_UNAVAILABLE',
    });
  });

  it('fails ROUTE_UNAVAILABLE when there are no candidates', () => {
    const result = resolveCapabilityRoute('auto', []);
    expect(result).toEqual({
      ok: false,
      error: 'No capability route is configured',
      code: 'ROUTE_UNAVAILABLE',
    });
  });
});
