import { describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { LATENCY_AXIS, scatterAxes, scatterValue } from '../scatterModel';
import { bestValue, type ChartRun } from '../chartModel';

const row = (p: Partial<RunRow>) => ({ metric_averages: {}, avg_latency_ms: null, ...p }) as RunRow;

describe('Charts scatter axes (C052)', () => {
  it('offers latency first, then the metrics by how many runs scored them', () => {
    const rows = [
      row({ metric_averages: { tone: 0.5, relevance: 0.7 }, avg_latency_ms: 900 }),
      row({ metric_averages: { relevance: 0.6 }, avg_latency_ms: 1200 }),
    ];
    expect(scatterAxes(rows)).toEqual({
      options: [LATENCY_AXIS, 'relevance', 'tone'],
      defaultY: 'relevance',
    });
    expect(scatterValue(rows[1]!, LATENCY_AXIS)).toBe(1200);
    expect(scatterValue(rows[1]!, 'tone')).toBeNull();
  });
});

describe('bestValue (C149)', () => {
  const runs = [
    { metric_averages: { acc: 0.7, cost: 3 } },
    { metric_averages: { acc: 0.9, cost: 1 } },
  ] as unknown as ChartRun[];
  it('is the highest score, or the lowest for a minimize metric', () => {
    expect(bestValue(runs, 'acc', 'maximize')).toBe(0.9);
    expect(bestValue(runs, 'acc', null)).toBe(0.9);
    expect(bestValue(runs, 'cost', 'minimize')).toBe(1);
    expect(bestValue(runs, 'missing', null)).toBeNull();
  });
});
