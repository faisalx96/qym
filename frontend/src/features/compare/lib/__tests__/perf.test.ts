import { describe, expect, it } from 'vitest';
import { buildCompareModel } from '../model';
import { metricCtx } from '../scoring';
import { computeComparisonStats } from '../stats';
import { applyFilters, emptyView } from '../filters';
import { columnItemScores, compareWithBaseline, metricColumns } from '../baseline';
import { makePayload } from './fixtures';

// 20 runs x 2000 items, the "hundreds of ms per keystroke" case of brief 05 §7.1.
const ITEMS = 2000;
const RUNS = 20;
function build() {
  const payload = makePayload(
    Array.from({ length: RUNS }, (_, r) => ({
      id: `run-${r}`,
      model: `m${r % 4}`,
      scores: Object.fromEntries(
        Array.from({ length: ITEMS }, (_, i) => {
          const q = ((i * 31 + r * 17) % 100) / 100;
          return [`item-${i}`, { correct: q > 0.6 ? 1 : 0, quality: q }];
        }),
      ),
      metaByItem: Object.fromEntries(
        Array.from({ length: ITEMS }, (_, i) => [
          `item-${i}`,
          { domain: `d${i % 5}`, complexity: ['easy', 'medium', 'hard'][i % 3] },
        ]),
      ),
    })),
  );
  return buildCompareModel(
    payload,
    payload.runs.map((r) => r.run.run_id),
  );
}

describe('20 runs x 2000 items stays interactive on the main thread', () => {
  const model = build();
  const ctx = metricCtx(model, 'quality');
  const time = (fn: () => void) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  it('stats, baseline deltas and a full filter pass', () => {
    const cold = time(() => computeComparisonStats(model, ctx));
    const stats = time(() => computeComparisonStats(model, ctx));
    const deltas = time(() => {
      const cols = metricColumns(model, 'run');
      const base = columnItemScores(model, cols[0]!, ctx);
      cols.slice(1).forEach((c) => compareWithBaseline(columnItemScores(model, c, ctx), base, ctx));
    });
    const run = () =>
      applyFilters({ model, view: emptyView(), metric: 'quality', thresholds: {}, groups: null });
    const firstFilter = time(run);
    const filter = time(run);
    void firstFilter;
    console.log(
      `perf ms: cold(matrix build+stats)=${cold.toFixed(0)} stats=${stats.toFixed(0)} deltas=${deltas.toFixed(0)} filter=${filter.toFixed(0)}`,
    );
    expect(stats).toBeLessThan(2000);
    expect(deltas).toBeLessThan(2000);
    expect(filter).toBeLessThan(4000);
  });
});
