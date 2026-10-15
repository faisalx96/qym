/** Round 3 P3: the pure category helpers. */
import { describe, expect, it } from 'vitest';
import {
  barFraction,
  defaultKey,
  insightLine,
  orderValues,
  switcherKind,
  visibleValues,
} from './categoryModel';
import type { CategoryGroupStat } from './overviewModel';
import { metricBand } from '@/lib/metrics';

const g = (value: string, avgScore: number | null, itemCount = 10): CategoryGroupStat => ({
  value,
  avgScore,
  itemCount,
  passRate: null,
  avgLatency: null,
});

describe('categoryModel', () => {
  it('defaultKey picks the largest spread and falls back to the first key', () => {
    const spread: Record<string, number> = { a: 0.1, b: 0.5, c: 0.3 };
    expect(defaultKey(['a', 'b', 'c'], (k) => spread[k]!)).toBe('b');
    expect(defaultKey(['a', 'c'], () => 0)).toBe('a');
    expect(defaultKey([], () => 0)).toBeNull();
  });

  it('orderValues is worst first or best first, direction aware, unscored last', () => {
    const groups = [g('a', 0.5), g('b', 0.2), g('c', null), g('d', 0.9)];
    expect(orderValues(groups, 'worst', 'maximize').map((x) => x.value)).toEqual(['b', 'a', 'd', 'c']);
    expect(orderValues(groups, 'best', 'maximize').map((x) => x.value)).toEqual(['d', 'a', 'b', 'c']);
    expect(orderValues(groups, 'worst', 'minimize').map((x) => x.value)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('insightLine needs two scored values', () => {
    const fmt = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);
    const b = { key: 'k', metric: 'm', overallAverage: 0.49, groups: [g('x', 0.25, 66), g('y', 0.8, 54)] };
    expect(insightLine(b, 'maximize', fmt, false)).toContain('Weakest: x 25%');
    expect(insightLine({ ...b, groups: [g('x', 0.25)] }, 'maximize', fmt, false)).toBeNull();
  });

  it('visibleValues shows six rows until expanded', () => {
    const rows = Array.from({ length: 24 }, (_, i) => i);
    expect(visibleValues(rows, 6, false)).toHaveLength(6);
    expect(visibleValues(rows, 6, true)).toHaveLength(24);
  });

  it('switcherKind: segmented for up to 5 short keys that fit, a Select otherwise', () => {
    const keys = [
      { key: 'complexity', count: 4 },
      { key: 'domain', count: 5 },
    ];
    expect(switcherKind(keys, 1193)).toBe('segmented');
    expect(switcherKind(keys, 279)).toBe('select');
    expect(
      switcherKind(
        Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, count: 2 })),
        1193,
      ),
    ).toBe('select');
  });

  it('barFraction scales a raw number to the largest and keeps a score as is', () => {
    expect(barFraction(0.25, null)).toBe(0.25);
    expect(barFraction(50, 200)).toBe(0.25);
    expect(barFraction(null, 1)).toBe(0);
  });

  it('colours follow metricBand: direction aware, none without a direction or for a raw number (P3-10)', () => {
    expect(metricBand(0.95, 'score', 'maximize')).toBe(5);
    expect(metricBand(0.95, 'score', 'minimize')).toBe(1);
    expect(metricBand(0.95, 'score', null)).toBeNull();
    expect(metricBand(120, 'numeric', 'maximize')).toBeNull();
  });
});
