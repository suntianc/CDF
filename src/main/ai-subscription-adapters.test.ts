import { describe, expect, it, vi } from 'vitest';
import { connectMiniMaxTokenPlan } from './ai-subscription-adapters';

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
