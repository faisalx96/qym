import { describe, expect, it } from 'vitest';
import {
  categoryInsight,
  categorySpread,
  sortCategoryGroups,
  type CategoryGroupStat,
} from '../overviewModel';

const g = (value: string, avgScore: number | null, itemCount = 10): CategoryGroupStat => ({
  value,
  avgScore,
  itemCount,
  passRate: null,
  avgLatency: null,
});
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

describe('category helpers', () => {
  it('spread is best minus worst, 0 under two scored groups', () => {
    expect(categorySpread({ groups: [g('a', 0.2), g('b', 0.8), g('c', null)] })).toBeCloseTo(0.6);
    expect(categorySpread({ groups: [g('a', 0.2)] })).toBe(0);
  });
  it('sorts worst first by direction, unscored last', () => {
    const groups = [g('a', 0.5), g('b', 0.2), g('c', null), g('d', 0.9)];
    expect(sortCategoryGroups(groups, 'worst', 'maximize').map((x) => x.value)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortCategoryGroups(groups, 'worst', 'minimize').map((x) => x.value)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortCategoryGroups(groups, 'best', 'maximize').map((x) => x.value)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortCategoryGroups([g('x', 1, 3), g('y', 1, 9)], 'items', null).map((x) => x.value)).toEqual([
      'y',
      'x',
    ]);
  });
  it('writes the insight line and hides it for one value', () => {
    const b = {
      key: 'k',
      metric: 'm',
      overallAverage: 0.49,
      groups: [g('expert', 0.25, 66), g('easy', 0.8, 54)],
    };
    expect(categoryInsight(b, 'maximize', pct, false)).toBe(
      'Weakest: expert 25% (66 items, 24 pts below overall). Strongest: easy 80%.',
    );
    expect(categoryInsight({ ...b, groups: [g('only', 0.5)] }, 'maximize', pct, false)).toBeNull();
  });
});
