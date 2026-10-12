import { describe, expect, it } from 'vitest';
import { buildCompareModel } from '../model';
import {
  metricColumns,
  resolveBaseline,
  columnItemScores,
  compareWithBaseline,
  deltaKind,
  formatDelta,
  formatBand,
} from '../baseline';
import { computeComparisonStats, statRates } from '../stats';
import { metricCtx } from '../scoring';
import {
  computeGroupedComparison,
  filterSweepItems,
  resolveCohorts,
  summarizeSweepItems,
  DEFAULT_SWEEP_FILTERS,
  reverseSweepItem,
  sweepOutcomeOf,
} from '../cohort';
import { makePayload } from './fixtures';

const quality = (v: number) => ({ correct: v >= 0.7 ? 1 : 0, quality: v });
const mk = (n: number, f: (i: number) => number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`i${i + 1}`, quality(f(i))]));

describe('comparison stats', () => {
  const payload = makePayload([
    { id: 'A', model: 'm1', scores: mk(4, (i) => [0.9, 0.9, 0.2, 0.2][i]!) },
    { id: 'B', model: 'm1', scores: mk(4, (i) => [0.9, 0.2, 0.9, 0.2][i]!) },
    { id: 'C', model: 'm1', scores: mk(4, (i) => [0.9, 0.2, 0.2, 0.9][i]!) },
  ]);
  const model = buildCompareModel(payload, ['A', 'B', 'C']);
  const ctx = metricCtx(model, 'quality');

  it('counts passes, winners, ties and the distribution', () => {
    const s = computeComparisonStats(model, ctx);
    expect(s.totalCompared).toBe(4);
    expect(s.avgScores[0]).toBeCloseTo(0.55);
    expect(s.wins).toEqual([1, 1, 1]);
    expect(s.ties).toBe(1); // i1: all 0.9
    expect(s.winners.get('i1')).toBe('tie');
    expect(s.winners.get('i2')).toBe(0);
    expect(s.correctDistribution).toEqual([0, 3, 0, 1]);
    expect(s.passAtK).toBe(4);
    expect(s.passHatK).toBe(1);
    const rates = statRates(s);
    expect(rates.passAtK).toBe(1);
    expect(rates.consistency).toBeCloseTo((1 + 3 * (1 / 3)) / 4);
    expect(rates.reliability).toBeCloseTo((1 + 3 * (1 / 3)) / 4);
  });

  it('recomputes over a subset of items (filtered stats)', () => {
    const s = computeComparisonStats(model, ctx, ['i1', 'i2']);
    expect(s.totalCompared).toBe(2);
    expect(s.avgScores[1]).toBeCloseTo(0.55);
    expect(s.correctDistribution).toEqual([0, 1, 0, 1]);
  });

  it('with no direction there are no winners, passes or Max@K', () => {
    const noDir = makePayload([
      {
        id: 'A',
        scores: mk(2, () => 0.5),
        specs: { correct: { score_type: 'boolean' }, quality: { score_type: 'percentage' } },
      },
      {
        id: 'B',
        scores: mk(2, () => 0.6),
        specs: { correct: { score_type: 'boolean' }, quality: { score_type: 'percentage' } },
      },
    ]);
    const m = buildCompareModel(noDir, ['A', 'B']);
    const s = computeComparisonStats(m, metricCtx(m, 'quality'));
    expect(s.wins).toEqual([0, 0]);
    expect(s.itemsWithBest).toBe(0);
    expect(s.passAtK).toBe(0);
  });
});

describe('baseline paired stats', () => {
  const payload = makePayload([
    { id: 'A', model: 'm1', scores: mk(6, (i) => 0.5 + i * 0.01) },
    { id: 'B', model: 'm2', scores: mk(6, (i) => 0.7 + i * 0.01) },
    {
      id: 'R',
      model: 'm3',
      samples: 2,
      scores: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          `i${i + 1}`,
          { correct: [1, 1], quality: [0.5 + i * 0.01, 0.7 + i * 0.01] },
        ]),
      ),
    },
  ]);
  const model = buildCompareModel(payload, ['A', 'B', 'R']);
  const ctx = metricCtx(model, 'quality');

  it('columns: run average collapses passes, each pass keeps them', () => {
    expect(metricColumns(model, 'run').map((c) => c.key)).toEqual(['A', 'B', 'R']);
    expect(metricColumns(model, 'each').map((c) => c.key)).toEqual(['A', 'B', 'R::pass1', 'R::pass2']);
    const cols = metricColumns(model, 'run');
    expect(resolveBaseline(cols, null)!.key).toBe('A');
    expect(resolveBaseline(cols, 'R::pass2')!.key).toBe('R');
    expect(resolveBaseline(cols, 'nope')!.key).toBe('A');
  });

  it('paired mean delta with a 95% band', () => {
    const cols = metricColumns(model, 'run');
    const a = columnItemScores(model, cols[0]!, ctx);
    const b = columnItemScores(model, cols[1]!, ctx);
    const r = compareWithBaseline(b, a, ctx);
    expect(r.paired).toBe(6);
    expect(r.mean).toBeCloseTo(0.2);
    expect(r.counts).toEqual({ improved: 6, regressed: 0, same: 0 });
    // identical diffs -> zero variance -> verdict by sign
    expect(r.halfWidth).toBe(0);
    expect(r.pValue).toBe(0);
    expect(r.verdict).toBe('improved');
    const avgCol = columnItemScores(model, cols[2]!, ctx);
    expect(avgCol.get('i1')).toBeCloseTo(0.6);
  });

  it('noise band and p-value on varying diffs; subset restricts items', () => {
    const base = new Map([
      ['x', 0.5],
      ['y', 0.5],
      ['z', 0.5],
      ['w', 0.5],
    ]);
    const cand = new Map([
      ['x', 0.6],
      ['y', 0.4],
      ['z', 0.7],
      ['w', 0.5],
    ]);
    const r = compareWithBaseline(cand, base, { direction: 'maximize' });
    expect(r.counts).toEqual({ improved: 2, regressed: 1, same: 1 });
    expect(r.mean).toBeCloseTo(0.05);
    // variance of [0.1,-0.1,0.2,0] around 0.05, n-1
    const diffs = [0.1, -0.1, 0.2, 0];
    const v = diffs.reduce((s, d) => s + (d - 0.05) ** 2, 0) / 3;
    // Student t (df=3, 3.182446), scipy: t.ppf(.975, 3) * se = 0.2054260
    expect(r.halfWidth).toBeCloseTo(3.182446 * Math.sqrt(v / 4), 5);
    expect(r.halfWidth).toBeCloseTo(0.205426, 5);
    expect(r.pValue).toBeCloseTo(0.495025, 5); // scipy ttest_1samp
    expect(r.verdict).toBe('within_noise');
    expect(compareWithBaseline(cand, base, { direction: 'maximize' }, new Set(['x', 'z'])).paired).toBe(2);
  });

  it('direction decides improved/regressed; formats', () => {
    expect(deltaKind(-0.1, 'minimize')).toBe('improved');
    expect(deltaKind(-0.1, 'maximize')).toBe('regressed');
    expect(deltaKind(1e-12, 'maximize')).toBe('same');
    expect(formatDelta(0.175, 'score')).toBe('+17.5 pts');
    expect(formatDelta(-0.15, 'score')).toBe('−15.0 pts');
    expect(formatBand(0.155, 'score')).toBe('±15.5');
  });
});

describe('cohorts and sweep', () => {
  // A: m1 x2 runs, B: m2 x2 runs, 4 items
  const payload = makePayload([
    { id: 'A1', model: 'm1', scores: mk(4, (i) => [0.9, 0.9, 0.2, 0.2][i]!) },
    { id: 'A2', model: 'm1', scores: mk(4, (i) => [0.9, 0.2, 0.2, 0.2][i]!) },
    { id: 'B1', model: 'm2', scores: mk(4, (i) => [0.9, 0.9, 0.9, 0.2][i]!) },
    { id: 'B2', model: 'm2', scores: mk(4, (i) => [0.9, 0.9, 0.9, 0.2][i]!) },
  ]);
  const model = buildCompareModel(payload, ['A1', 'A2', 'B1', 'B2']);
  const ctx = metricCtx(model, 'quality');

  it('infers cohorts by model when counts match, explicit cohorts win', () => {
    const inferred = resolveCohorts(model, null)!;
    expect(inferred).toMatchObject({
      left: ['A1', 'A2'],
      right: ['B1', 'B2'],
      leftLabel: 'm1',
      k: 2,
      explicit: false,
    });
    const explicit = resolveCohorts(model, {
      left: ['A1', 'B1'],
      right: ['A2', 'B2'],
      leftLabel: 'Cohort A',
      rightLabel: 'mine',
    })!;
    expect(explicit.explicit).toBe(true);
    expect(explicit.rightLabel).toBe('mine');
    expect(explicit.leftLabel).toBe('A1');
    const three = buildCompareModel(
      makePayload([
        { id: 'x', model: 'a', scores: mk(1, () => 1) },
        { id: 'y', model: 'b', scores: mk(1, () => 1) },
        { id: 'z', model: 'c', scores: mk(1, () => 1) },
      ]),
      ['x', 'y', 'z'],
    );
    expect(resolveCohorts(three, null)).toBeNull();
  });

  it('groups items into moves and buckets', () => {
    const groups = resolveCohorts(model, null)!;
    const g = computeGroupedComparison(model, groups, ctx);
    expect(g.eligibleItems).toBe(4);
    const byId = Object.fromEntries(g.items.map((i) => [i.itemId, i]));
    expect(byId.i1!.move).toBe(0);
    expect(byId.i2!.move).toBe(1); // 1/2 -> 2/2
    expect(byId.i3!.move).toBe(2);
    expect(g.buckets.b_sweeps_a.itemIds).toEqual(['i3']);
    expect(g.buckets.both_pass.itemIds).toEqual(['i1']);
    expect(g.buckets.both_fail.itemIds).toEqual(['i4']);
    expect(g.items[0]!.itemId).toBe('i3'); // biggest move first
    const sum = summarizeSweepItems(g.items, 2, 2, null, 'maximize');
    expect(sum.counts).toMatchObject({
      improved: 2,
      regressed: 0,
      unchanged: 2,
      decisivelyFixed: 1,
      decisivelyBroken: 0,
    });
    expect(sum.left.passAtK).toBeCloseTo((1 + 1 + 0 + 0) / 4);
    expect(sum.right.passAtK).toBeCloseTo(3 / 4);
    expect(sum.left.avgAtK).toBeCloseTo((0.9 + 0.9 + 0.2 + 0.2 + 0.9 + 0.2 + 0.2 + 0.2) / 8);
    expect(sum.noise!.passAtK).not.toBeNull();
  });

  it('filters by move/outcome/metadata and reverses sides', () => {
    const groups = resolveCohorts(model, null)!;
    const g = computeGroupedComparison(model, groups, ctx);
    expect(
      filterSweepItems(g.items, { ...DEFAULT_SWEEP_FILTERS, move: 'improved' })
        .map((i) => i.itemId)
        .sort(),
    ).toEqual(['i2', 'i3']);
    expect(
      filterSweepItems(g.items, { ...DEFAULT_SWEEP_FILTERS, outcome: 'right_sweeps_left' }).map(
        (i) => i.itemId,
      ),
    ).toEqual(['i3']);
    expect(filterSweepItems(g.items, { ...DEFAULT_SWEEP_FILTERS, q: 'i4' }).map((i) => i.itemId)).toEqual([
      'i4',
    ]);
    const rev = g.items.map(reverseSweepItem);
    expect(rev.find((i) => i.itemId === 'i3')!.move).toBe(-2);
    expect(sweepOutcomeOf(rev.find((i) => i.itemId === 'i3')!)).toBe('left_sweeps_right');
  });

  it('items missing from any cohort run are ineligible; scorer errors count as failures', () => {
    const p = makePayload([
      {
        id: 'A',
        model: 'm1',
        scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 1, quality: 'error' } },
      },
      { id: 'B', model: 'm2', scores: { i1: { correct: 1, quality: 0.9 } } },
    ]);
    const m = buildCompareModel(p, ['A', 'B']);
    const g = computeGroupedComparison(m, resolveCohorts(m, null)!, metricCtx(m, 'quality'));
    expect(g.eligibleItems).toBe(1);
    // higher-is-better: an error scores 0 and fails
    const p2 = makePayload([
      { id: 'A', model: 'm1', scores: { i1: { correct: 1, quality: 'error' } } },
      { id: 'B', model: 'm2', scores: { i1: { correct: 1, quality: 0.9 } } },
    ]);
    const m2 = buildCompareModel(p2, ['A', 'B']);
    const g2 = computeGroupedComparison(m2, resolveCohorts(m2, null)!, metricCtx(m2, 'quality'));
    expect(g2.items[0]!.leftPasses).toEqual([false]);
    expect(g2.items[0]!.leftScores).toEqual([0]);
  });
});
