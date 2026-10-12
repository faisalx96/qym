/**
 * Cutover of the vanilla-Compare JavaScript tests (test_minimize_errors.py, test_metric_semantics.py):
 * errors and the declared direction decide winners, Pass@K, Sweep buckets and verdicts. The vanilla
 * compare.html functions are gone; these run the same cases against the React compare libraries.
 */
import { describe, expect, it } from 'vitest';
import type { Row } from '@/features/run-detail/types';
import { buildCompareModel, type ComparePayload } from '../model';
import { metricCtx } from '../scoring';
import { computeComparisonStats, statRates } from '../stats';
import { columnItemScores, metricColumns } from '../baseline';
import { applyFilters, emptyView } from '../filters';
import { computeGroupedComparison, resolveCohorts, summarizeSweepItems, type SweepItem } from '../cohort';
import { computeSweepNoise } from '../noise';

type Cell = number | '' | null;
interface RowIn {
  value: Cell;
  meta?: Record<string, unknown>;
  task?: boolean;
  passes?: { scores: Cell[]; meta: Array<Record<string, unknown> | null>; attempts: Array<{ status: string }> };
}

const SPEC_MIN = { score_type: 'percentage', direction: 'minimize', pass_threshold: 0.2, schema_version: 2 };

function run(id: string, rows: RowIn[], opts: { metric?: string; spec?: Record<string, unknown> | null; samples?: number; model?: string } = {}) {
  const metric = opts.metric ?? 'h';
  const specs = opts.spec === null ? {} : { [metric]: opts.spec ?? SPEC_MIN };
  const samples = opts.samples ?? 1;
  const out: Row[] = rows.map((r, i) => {
    const row: Row = {
      index: i,
      item_id: `item-${i}`,
      compare_item_id: `item-${i}`,
      status: r.task ? 'error' : 'completed',
      error: r.task ? 'task failed' : '',
      metric_values: [r.value],
      metric_meta: r.meta ? { [metric]: r.meta } : {},
      item_metadata: {},
      latency_ms: 100,
      retry_count: 0,
    } as Row;
    if (r.passes) {
      row.pass_scores = { [metric]: r.passes.scores as number[] };
      row.pass_metric_meta = { [metric]: r.passes.meta };
      row.pass_attempts = r.passes.attempts as Row['pass_attempts'];
    }
    return row;
  });
  return {
    run: {
      run_id: id,
      file_path: id,
      run_name: id,
      model_name: opts.model ?? id,
      metric_names: [metric],
      metric_specs: specs,
      status: 'COMPLETED',
      samples,
      config: { samples },
      metadata: {},
    },
    snapshot: { rows: out, metric_names: [metric], metric_specs: specs },
  } as unknown as ComparePayload['runs'][number];
}

const payloadOf = (...runs: ComparePayload['runs']): ComparePayload => ({
  runs,
  compare_alignment_status: 'aligned',
  unalignable_runs: [],
  missing_runs: [],
});

const cohortOf = (model: ReturnType<typeof buildCompareModel>, left: string[], right: string[]) => {
  const groups = resolveCohorts(model, { left, right, leftLabel: 'A', rightLabel: 'B' })!;
  return groups;
};

describe('Sweep: errors fail and carry no score when lower is better (C015 amended)', () => {
  it('counts errored items and passes as failures', () => {
    const left = run('L', [
      { value: 0, meta: { status: 'error' } },
      { value: 0, task: true },
      { value: 0.1 },
    ]);
    const right = run('R', [{ value: 0.1 }, { value: 0.1 }, { value: 0.1 }]);
    const repeat = run(
      'P',
      [
        {
          value: 0.05,
          passes: {
            scores: [0, 0.1, 0],
            meta: [{ status: 'error' }, null, { label: 'error' }],
            attempts: [{ status: 'completed' }, { status: 'completed' }, { status: 'error' }],
          },
        },
      ],
      { samples: 3 },
    );
    const model = buildCompareModel(payloadOf(left, right), ['L', 'R']);
    const ctx = metricCtx(model, 'h');
    const grouped = computeGroupedComparison(model, cohortOf(model, ['L'], ['R']), ctx);
    // Both errored left items fail and have no score; item-2 passes on both.
    expect(grouped.eligibleItems).toBe(3);
    const summary = summarizeSweepItems(grouped.items, 1, 1, null, 'minimize');
    expect(summary.left.passAtK).toBeCloseTo(1 / 3, 9);
    expect(summary.right.passAtK).toBeCloseTo(1.0, 9);
    expect(summary.left.avgAtK).toBeCloseTo(0.1, 9);
    expect(Object.fromEntries(Object.entries(grouped.buckets).map(([k, v]) => [k, v.count]))).toEqual({
      a_sweeps_b: 0,
      b_sweeps_a: 2,
      both_pass: 1,
      both_fail: 0,
    });
    expect(summary.counts.improved).toBe(2);

    // A repeat item: the scorer-error and task-error passes fail, unscored.
    const repeatModel = buildCompareModel(payloadOf(repeat, right), ['P::pass1', 'P::pass2', 'P::pass3', 'R']);
    const repeatGroups = cohortOf(repeatModel, ['P::pass1', 'P::pass2', 'P::pass3'], ['R']);
    const perPass = computeGroupedComparison(repeatModel, repeatGroups, metricCtx(repeatModel, 'h'));
    expect(perPass.items[0]!.leftPasses).toEqual([false, true, false]);
    expect(perPass.items[0]!.leftScores).toEqual([0.1]);
  });

  it('a side without a score has no average and no delta, never 0', () => {
    const E = run('E', [
      { value: 0, meta: { status: 'error' } },
      { value: 0, meta: { status: 'error' } },
    ]);
    const M = run('M', [{ value: 0.6 }, { value: 0.1 }]);
    const Z = run('Z', [{ value: 0 }, { value: 0 }]);
    const side = (l: string, r: string, spec: Record<string, unknown> = SPEC_MIN) => {
      const e = { ...E, snapshot: { ...E.snapshot, metric_specs: { h: spec } }, run: { ...E.run, metric_specs: { h: spec } } };
      const m = { ...M, snapshot: { ...M.snapshot, metric_specs: { h: spec } }, run: { ...M.run, metric_specs: { h: spec } } };
      const z = { ...Z, snapshot: { ...Z.snapshot, metric_specs: { h: spec } }, run: { ...Z.run, metric_specs: { h: spec } } };
      const model = buildCompareModel(payloadOf(e, m, z), [l, r]);
      const grouped = computeGroupedComparison(model, cohortOf(model, [l], [r]), metricCtx(model, 'h'));
      const s = summarizeSweepItems(grouped.items, 1, 1, null, spec.direction as 'minimize' | 'maximize');
      return [s.left.avgAtK, s.right.avgAtK, s.deltas.avgAtK, s.left.passAtK, s.right.passAtK];
    };
    // Every h entry of run E errored: no average and no delta, never 0.0 -> 0.35;
    // its errors still fail in the pass rates.
    expect(side('E', 'M')).toEqual([null, expect.closeTo(0.35, 9), null, 0, 0.5]);
    expect(side('M', 'E')).toEqual([expect.closeTo(0.35, 9), null, null, 0.5, 0]);
    expect(side('E', 'E')).toEqual([null, null, null, 0, 0]);
    // Measured zeros are scores.
    expect(side('Z', 'M')).toEqual([0, expect.closeTo(0.35, 9), expect.closeTo(0.35, 9), 1, 0.5]);
    // Higher is better: errors still count as 0.
    expect(side('E', 'M', { ...SPEC_MIN, direction: 'maximize' })).toEqual([
      0,
      expect.closeTo(0.35, 9),
      expect.closeTo(0.35, 9),
      0,
      0.5,
    ]);
  });

  it('a filter that leaves only an errored item shows no left average, delta or verdict band', () => {
    const entry = (left: number | null, right: number): SweepItem =>
      ({
        itemId: 'i',
        rawItemId: 'i',
        metadata: {},
        leftScores: left === null ? [] : [left],
        rightScores: [right],
        leftPasses: [left !== null && left <= 0.2],
        rightPasses: [right <= 0.2],
        leftAttempts: [1],
        rightAttempts: [1],
        leftPassCount: left !== null && left <= 0.2 ? 1 : 0,
        rightPassCount: right <= 0.2 ? 1 : 0,
        leftAvgAttempts: 1,
        rightAvgAttempts: 1,
        move: 0,
        bucketKey: null,
      }) as SweepItem;
    const a = entry(null, 0.6);
    const b = entry(0.1, 0.1);
    const all = summarizeSweepItems([a, b], 1, 1, null, 'minimize');
    expect(all.left.avgAtK).toBe(0.1);
    expect(all.deltas.avgAtK).toBeCloseTo(0.25, 9);
    // A filter that leaves only item a: no left average, delta or verdict.
    const only = summarizeSweepItems([a], 1, 1, null, 'minimize');
    expect(only.left.avgAtK).toBeNull();
    expect(only.right.avgAtK).toBe(0.6);
    expect(only.deltas.avgAtK).toBeNull();
    expect(only.noise!.avgAtK).toBeNull();
    expect(only.noise!.passAtK).toBeTruthy();
    expect([only.left.passAtK, only.right.passAtK]).toEqual([0, 0]);
    expect(summarizeSweepItems([], 1, 1, null, 'minimize').left.avgAtK).toBeNull();
    // A measured zero is a score.
    const zero = summarizeSweepItems([entry(0, 0.6)], 1, 1, null, 'minimize');
    expect(zero.left.avgAtK).toBe(0);
    expect(zero.deltas.avgAtK).toBe(0.6);
  });

  it('the Sweep verdict follows the direction (empty outputs fell 3.0% -> 0.4%: improved, not regressed)', () => {
    // 500 items, 2 passes per side; empty on 15 left items, 2 right items.
    const items = Array.from({ length: 500 }, (_, i) => {
      const left = i < 15 ? [1, 1] : [0, 0];
      const right = i < 2 ? [1, 1] : [0, 0];
      return {
        leftScores: left,
        rightScores: right,
        leftPasses: left.map((v) => v <= 0.0001),
        rightPasses: right.map((v) => v <= 0.0001),
      };
    });
    const lower = computeSweepNoise(items, null, 'minimize');
    expect(lower.avgAtK!.verdict).toBe('improved');
    expect(lower.passAtK!.verdict).toBe('improved');
    const higher = computeSweepNoise(items, null, 'maximize');
    expect(higher.avgAtK!.verdict).toBe('regressed');
  });
});

describe('Compare winners, Pass@K and Max@K follow the declared direction', () => {
  const bools = (values: number[]) => values.map((value) => ({ value }));
  const spec = (direction: string | null) =>
    direction === null ? null : { score_type: 'boolean', direction, schema_version: 2 };

  it('lower wins when lower is better; a neutral metric has no winners', () => {
    const mk = (direction: 'minimize' | null) => {
      const s = direction ? { score_type: 'percentage', direction, pass_threshold: 0.2, schema_version: 2 } : { score_type: 'percentage', schema_version: 2 };
      const model = buildCompareModel(
        payloadOf(
          run('A', [{ value: 0.3 }, { value: 0.1 }], { metric: 'empty', spec: s }),
          run('B', [{ value: 0.1 }, { value: 0.1 }], { metric: 'empty', spec: s }),
        ),
        ['A', 'B'],
      );
      return computeComparisonStats(model, metricCtx(model, 'empty'));
    };
    const lower = mk('minimize');
    // Lower wins: run 2 wins item 0; item 1 ties.
    expect(lower.wins).toEqual([0, 1]);
    expect(lower.ties).toBe(1);
    expect(lower.winners.get('item-0')).toBe(1);
    expect(lower.maxAtK / lower.itemsWithBest).toBeCloseTo(0.1, 9);
    expect(lower.passAtK).toBe(2);
    const neutral = mk(null);
    expect(neutral.wins).toEqual([0, 0]);
    expect(neutral.ties).toBe(0);
    expect([...neutral.winners.values()]).toEqual([null, null]);
    expect(neutral.passAtK).toBe(0);
    expect(neutral.maxAtK).toBe(0);
  });

  it('item-level Pass@K, Pass^K and Max@K by direction (boolean empty-output metric)', () => {
    const build = (direction: string | null) => {
      const s = spec(direction);
      const model = buildCompareModel(
        payloadOf(
          run('A', bools([1, 0, 0]), { metric: 'empty', spec: s }),
          run('B', bools([0, 0, 1]), { metric: 'empty', spec: s }),
        ),
        ['A', 'B'],
      );
      const stats = computeComparisonStats(model, metricCtx(model, 'empty'));
      return { stats, rates: statRates(stats) };
    };
    // Lower is better: False (0) passes; Max@K is the per-item minimum.
    const lower = build('minimize');
    expect(lower.rates.passAtK).toBe(1);
    expect(lower.rates.passHatK).toBeCloseTo(1 / 3, 9);
    expect(lower.rates.maxAtK).toBe(0);
    // Higher is better keeps the historical result.
    const higher = build('maximize');
    expect(higher.rates.passAtK).toBeCloseTo(2 / 3, 9);
    expect(higher.rates.maxAtK).toBeCloseTo(2 / 3, 9);
    // No direction: no passes at all (views show values only).
    const neutral = build(null);
    expect(neutral.rates.passAtK).toBe(0);
    expect(neutral.stats.overallAvgScore).toBeCloseTo(1 / 3, 9);
  });

  it('cohort buckets follow the direction', () => {
    const s = spec('minimize');
    const model = buildCompareModel(
      payloadOf(
        run('a', bools([1, 1]), { metric: 'empty', spec: s }),
        run('b', bools([0, 0]), { metric: 'empty', spec: s }),
      ),
      ['a', 'b'],
    );
    const grouped = computeGroupedComparison(model, cohortOf(model, ['a'], ['b']), metricCtx(model, 'empty'));
    const summary = summarizeSweepItems(grouped.items, 1, 1, null, 'minimize');
    expect(summary.counts.improved).toBe(2);
    expect(grouped.buckets.b_sweeps_a.count).toBe(2);
  });
});

describe('Compare with a lower-is-better metric that has errors (test_minimize_errors_browser.py)', () => {
  const SPECS = {
    accuracy: { score_type: 'boolean', direction: 'minimize', schema_version: 2 },
    count: { score_type: 'number', direction: 'maximize' },
  };
  const wide = (id: string, rows: Array<{ value: number | ''; meta?: Record<string, unknown>; task?: boolean }>) => {
    const built = rows.map(
      (r, i) =>
        ({
          index: i,
          item_id: `item-${i}`,
          compare_item_id: `item-${i}`,
          status: r.task ? 'error' : 'completed',
          error: r.task ? 'task boom' : '',
          metric_values: [r.value, i],
          metric_meta: r.meta ? { accuracy: r.meta } : {},
          item_metadata: {},
          latency_ms: 100,
        }) as unknown as Row,
    );
    return {
      run: { run_id: id, file_path: id, run_name: id, model_name: id, metric_names: ['accuracy', 'count'], metric_specs: SPECS, status: 'COMPLETED', samples: 1, config: {}, metadata: {} },
      snapshot: { rows: built, metric_names: ['accuracy', 'count'], metric_specs: SPECS },
    } as unknown as ComparePayload['runs'][number];
  };

  it('leaves errors out of the mean and never counts them as passes', () => {
    // run-1: items 1, 2 scorer errors stored as False (0), item 4 a task error; run-2 has none
    const plain = Array.from({ length: 10 }, (_, i) => ({ value: (i % 2) as number | '' }));
    const first = plain.map((r, i) =>
      i === 1 || i === 2 ? { value: 0 as number | '', meta: { status: 'error', error: 'judge 429' } } : i === 4 ? { value: '' as number | '', task: true } : r,
    );
    const model = buildCompareModel(payloadOf(wide('run-1', first), wide('run-2', plain)), ['run-1', 'run-2']);
    const ctx = metricCtx(model, 'accuracy');
    const [one, two] = metricColumns(model, 'run');
    const mean = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0) / m.size;
    // run-1 without its 3 errors: items 0, 3, 5..9 -> True on 3, 5, 7, 9
    expect(mean(columnItemScores(model, one!, ctx))).toBeCloseTo(4 / 7, 9);
    expect(mean(columnItemScores(model, two!, ctx))).toBeCloseTo(0.5, 9);
    // items 2 and 4 pass (False) only on run-2: run-1's errors fail
    const ids = (show: string) => applyFilters({ model, view: { ...emptyView(), show }, metric: 'accuracy', thresholds: {}, groups: null }).items.map((i) => Number(i.itemId.slice(5))).sort((a, b) => a - b);
    expect(ids('all_correct')).toEqual([0, 6, 8]);
    expect(ids('unique_solve')).toEqual([2, 4]);
    expect(computeComparisonStats(model, ctx).correctDistribution).toEqual([5, 2, 3]);
  });

  it('averages Min@K over the items with a best score, and an item without one still fails', () => {
    const specs = {
      accuracy: { score_type: 'percentage', direction: 'minimize', pass_threshold: 0.7, schema_version: 2 },
      count: SPECS.count,
    };
    for (const [measured, best] of [
      [[0.6, 0.8], 0.6],
      [[0.0, 0.8], 0.0],
    ] as const) {
      const mk = (id: string, first: number) => {
        const r = wide(id, [{ value: first }, { value: 0, meta: { status: 'error', error: 'judge 429' } }]);
        (r.run as { metric_specs: unknown }).metric_specs = specs;
        (r.snapshot as { metric_specs: unknown }).metric_specs = specs;
        return r;
      };
      const model = buildCompareModel(payloadOf(mk('run-1', measured[0]), mk('run-2', measured[1])), ['run-1', 'run-2']);
      const ctx = metricCtx(model, 'accuracy');
      const stats = computeComparisonStats(model, ctx);
      const rates = statRates(stats);
      expect(rates.maxAtK).toBeCloseTo(best, 9);
      expect(rates.passAtK).toBeCloseTo(0.5, 9);
      expect(rates.passHatK).toBe(0);
      expect([stats.totalCompared, stats.itemsWithBest]).toEqual([2, 1]);
      // only the errored item: no best score to average, so no zero
      const errored = computeComparisonStats(model, ctx, ['item-1']);
      expect([errored.totalCompared, errored.itemsWithBest, errored.maxAtK]).toEqual([1, 0, 0]);
      expect(errored.correctDistribution).toEqual([1, 0, 0]);
    }
  });
});
