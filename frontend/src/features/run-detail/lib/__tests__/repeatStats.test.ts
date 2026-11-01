import { describe, expect, it } from 'vitest';
import type { MetricRow } from '@/lib/metrics';
import { localRepeatStats, repeatStatsView, unbiasedPassAtK, unbiasedPassHatK } from '../repeatStats';

const row = (scores: unknown[], extra: Partial<MetricRow> = {}): MetricRow => ({
  pass_scores: { acc: scores },
  pass_attempts: scores.map(() => ({ status: 'completed' })),
  ...extra,
});

describe('unbiased estimators (C085, as qym.core.reducers)', () => {
  it('match the closed forms', () => {
    expect(unbiasedPassAtK(3, 2, 1)).toBeCloseTo(2 / 3);
    expect(unbiasedPassAtK(3, 2, 2)).toBe(1);
    expect(unbiasedPassAtK(3, 0, 3)).toBe(0);
    expect(unbiasedPassHatK(3, 2, 1)).toBeCloseTo(2 / 3);
    expect(unbiasedPassHatK(3, 2, 2)).toBeCloseTo(1 / 3);
    expect(unbiasedPassHatK(3, 2, 3)).toBe(0);
  });
});

describe('localRepeatStats', () => {
  it('computes the tiles, the band and the distribution the server returns', () => {
    const stats = localRepeatStats([row([1, 0, 1]), row([0, 0, 0])], 'acc', 0.5, 3, 'maximize')!;
    expect(stats.group?.total_items).toBe(2);
    expect(stats.group?.pass_at_k).toBeCloseTo(0.5);
    expect(stats.group?.pass_hat_k).toBe(0);
    expect(stats.group?.avg_at_k).toBeCloseTo(1 / 3);
    expect(stats.group?.max_at_k).toBeCloseTo(0.5);
    expect(stats.group?.consistency).toBeCloseTo(2 / 3);
    expect(stats.group?.reliability).toBeCloseTo(2 / 3);
    expect(stats.distribution).toEqual([1, 0, 1, 0]);
    expect(stats.band?.['1']?.pass_at_k).toBeCloseTo(1 / 3);
    expect(stats.band?.['1']?.pass_hat_k).toBeCloseTo(1 / 3);
    expect(stats.band?.['1']?.cumulative_avg).toBeCloseTo(0.5);
    expect(stats.band?.['3']?.n_items).toBe(2);
  });

  it('moves with the threshold without a server call', () => {
    const rows = [row([0.6, 0.7, 0.9])];
    expect(localRepeatStats(rows, 'acc', 0.65, 3, 'maximize')!.group?.pass_hat_k).toBeCloseTo(0);
    expect(localRepeatStats(rows, 'acc', 0.55, 3, 'maximize')!.group?.pass_hat_k).toBe(1);
  });

  it('leaves an errored pass out of a lower-is-better average, and it never passes', () => {
    const errored = row([0.1, 0, 0.3], {
      pass_metric_meta: { acc: [{}, { status: 'error' }, {}] },
    });
    const stats = localRepeatStats([errored], 'acc', 0.2, 3, 'minimize')!;
    expect(stats.group?.avg_at_k).toBeCloseTo(0.2);
    expect(stats.distribution).toEqual([0, 1, 0, 0]);
  });

  it('skips a pass that has no score and no attempt yet', () => {
    const running = {
      pass_scores: { acc: [1, null] },
      pass_attempts: [{ status: 'completed' }],
    } as MetricRow;
    const stats = localRepeatStats([running], 'acc', 0.5, 2, 'maximize')!;
    expect(stats.band?.['2']).toBeUndefined();
    expect(stats.group?.avg_at_k).toBe(1);
  });

  it('is null without pass scores', () => {
    expect(localRepeatStats([{ metric_values: [1] }], 'acc', 0.5, 3, 'maximize')).toBeNull();
  });
});

describe('repeatStatsView', () => {
  const local = localRepeatStats([row([1, 0])], 'acc', 0.5, 2, 'maximize');
  it('uses the server answer for this metric and threshold, else the browser numbers', () => {
    const server = { run_id: 'r', metric: 'acc', threshold: 0.5, samples: 2, group: { pass_at_k: 0.9 } };
    expect(repeatStatsView(server, true, local)?.group?.pass_at_k).toBe(0.9);
    expect(repeatStatsView(server, false, local)?.group?.pass_at_k).toBe(1);
    expect(repeatStatsView(undefined, false, null)).toBeUndefined();
  });
});
