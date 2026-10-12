/**
 * Server payloads -> React run page. Each tests/platform/fixtures/golden/payload_*.json is a
 * run-page snapshot that a pytest (tests/platform/_support_a1.share_run_page) proves the server
 * still produces, with the numbers the React run page must derive from it. Replaces the Node
 * harnesses that ran the deleted vanilla metrics.js / run.html against the same rows.
 */
import { describe, expect, it } from 'vitest';
import {
  getRowScore,
  isErrorRow,
  isMetricErrorMeta,
  isTaskErrorPass,
  rowMetricErrorCounts,
  scoreWithoutMetricErrors,
  type MetricDirection,
} from '@/lib/metrics';
import { buildRunModel } from '../runModel';
import { buildCompareModel, type ComparePayload } from '@/features/compare/lib/model';
import { columnItemScores, metricColumns } from '@/features/compare/lib/baseline';
import { metricCtx } from '@/features/compare/lib/scoring';
import { scopeRowToPass } from '../passScope';
import { effectiveThresholds, repeatDistributionBucket, type FilterContext } from '../filterRules';
import { categoryBreakdown, metricCardModel, runCounts } from '../overviewModel';
import { rowStatus } from '../rowDisplay';
import type { Row, RunPayload } from '../../types';

interface Golden {
  kind: string;
  samples: number;
  snapshot: { metric_names: string[]; metric_specs: Record<string, Record<string, unknown>>; rows: Row[] };
  expected: {
    means?: Record<string, number | null>;
    card_means?: Record<string, number | null>;
    status_counts?: Record<string, { pass: number; fail: number; error: number }>;
    error_counts?: Record<string, [number, number]>;
    error_rows?: string[];
    clean_means?: Record<string, { score: number | null; errors: number }>;
    /** metric -> per row (pass 1): is it an errored pass (task error or scorer error)? */
    label_verdicts?: Record<string, boolean[]>;
    /** Category Performance: groups[key]["<value>:<metric>"] = [avg score, pass rate]. */
    categories?: { view_pass: number | null; groups: Record<string, Record<string, [number, number]>> };
    /** Strip counters of the run page. */
    run_counts?: { total: number; completed: number; errors: number; notReceived: number };
    /** metric -> item id -> row status kind (pass / fail / error / not_received / done). */
    statuses?: Record<string, Record<string, string>>;
    /** metric -> text the metric card's error note starts or ends with. */
    card_notes?: Record<string, string>;
    /** metric -> item id -> the repeat distribution bar (passes that passed) the item falls in. */
    repeat_buckets?: Record<string, Record<string, number>>;
    /** Compare: the Metrics-tab mean of the repeat run, as one column and pass by pass. */
    compare_means?: { run: Record<string, number>; passes: Record<string, Record<string, number>> };
    /** Metric meta keys that must not be offered as judge fields. */
    meta_keys_exclude?: string[];
    /** One repeat item read pass by pass (a pass that succeeded is not a task error). */
    pass_rows?: {
      item_id: string;
      status: string[];
      [metric: string]: unknown;
    };
  };
}

const goldens = import.meta.glob<Golden>('../../../../../../tests/platform/fixtures/golden/payload_*.json', {
  eager: true,
  import: 'default',
});

function contextOf(golden: Golden, viewPass: number | null = null): FilterContext {
  const { snapshot, samples } = golden;
  const payload = {
    run: {
      run_id: 'r',
      status: 'COMPLETED',
      samples,
      metric_names: snapshot.metric_names,
      metric_specs: snapshot.metric_specs,
    },
    snapshot,
  } as unknown as RunPayload;
  const model = buildRunModel(payload, viewPass);
  return {
    model,
    thresholds: effectiveThresholds(model, { metric: null, threshold: null }),
    selectedMetric: model.defaultMetric,
    repeatAggregate: model.isRepeat && model.viewPass === null,
  };
}

const entries = Object.entries(goldens).filter(([, g]) => g.kind === 'run_page');

describe('golden run-page payloads', () => {
  it('has payloads to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  describe.each(entries)('%s', (_path, golden) => {
    const ctx = contextOf(golden);
    const { model } = ctx;
    const rows = model.rows;
    const direction = (metric: string): MetricDirection => model.metricDirections[metric] ?? null;
    const expected = golden.expected;

    if (expected.means)
      it('averages the rows to the server mean (errors by the declared direction)', () => {
        for (const [metric, want] of Object.entries(expected.means!)) {
          const idx = model.metricNames.indexOf(metric);
          let sum = 0;
          let count = 0;
          for (const row of rows) {
            const { score } = getRowScore(row, idx, metric, direction(metric));
            if (score !== null) {
              sum += score;
              count++;
            }
          }
          const got = count ? sum / count : null;
          if (want === null) expect(got, metric).toBeNull();
          else expect(got, metric).toBeCloseTo(want, 9);
        }
      });

    if (expected.card_means)
      it('shows the same mean on the metric card', () => {
        for (const [metric, want] of Object.entries(expected.card_means!)) {
          const card = metricCardModel(ctx, rows, metric);
          if (want === null) expect(card === null || card.avg === null, metric).toBe(true);
          else expect(card!.avg, metric).toBeCloseTo(want, 9);
        }
      });

    if (expected.status_counts)
      it('judges each item pass, fail or error by the declared direction', () => {
        for (const [metric, want] of Object.entries(expected.status_counts!)) {
          const got = { pass: 0, fail: 0, error: 0 };
          for (const row of rows) {
            const kind = rowStatus(ctx, row, metric).kind;
            if (kind === 'pass' || kind === 'fail' || kind === 'error') got[kind] += 1;
          }
          expect(got, metric).toEqual(want);
        }
      });

    if (expected.error_counts)
      it('counts task and scorer errors per metric', () => {
        for (const [metric, want] of Object.entries(expected.error_counts!)) {
          let task = 0;
          let scorer = 0;
          for (const row of rows) {
            const c = rowMetricErrorCounts(row, metric);
            task += c.task;
            scorer += c.scorer;
          }
          expect([task, scorer], metric).toEqual(want);
        }
      });

    if (expected.error_rows)
      it('flags the rows with an error', () => {
        expect(rows.filter((r) => isErrorRow(r)).map((r) => r.item_id)).toEqual(expected.error_rows);
      });

    if (expected.run_counts)
      it('counts items, completed, errors and not received', () => {
        const c = runCounts(rows, ctx.repeatAggregate);
        expect({ total: c.total, completed: c.completed, errors: c.errors, notReceived: c.notReceived }).toEqual(
          expected.run_counts,
        );
      });

    if (expected.statuses)
      it('reads each item as pass, fail, error or not received', () => {
        for (const [metric, want] of Object.entries(expected.statuses!)) {
          const got = Object.fromEntries(rows.map((r) => [r.item_id, rowStatus(ctx, r, metric).kind]));
          expect(got, metric).toEqual(want);
        }
      });

    if (expected.card_notes)
      it('says on the metric card how many errors it counts and how', () => {
        for (const [metric, want] of Object.entries(expected.card_notes!)) {
          expect(metricCardModel(ctx, rows, metric)?.errorNote?.text, metric).toContain(want);
        }
      });

    if (expected.repeat_buckets)
      it('puts each repeat item in the bar of the passes that passed', () => {
        for (const [metric, want] of Object.entries(expected.repeat_buckets!)) {
          const got = Object.fromEntries(
            rows.map((r) => [
              r.item_id,
              repeatDistributionBucket(ctx, r, metric, model.samples, model.defaultThresholds[metric] ?? 0.8),
            ]),
          );
          expect(got, metric).toEqual(want);
        }
      });

    if (expected.compare_means)
      it('Compare shows the list mean for the run column and the server pass means pass by pass', () => {
        const want = expected.compare_means!;
        const payload = {
          run: { run_id: 'rr', file_path: 'rr', run_name: 'rr', model_name: 'rr', samples: golden.samples, metric_names: golden.snapshot.metric_names, metric_specs: golden.snapshot.metric_specs, status: 'COMPLETED', config: {}, metadata: {} },
          snapshot: { ...golden.snapshot, rows: golden.snapshot.rows.map((r) => ({ ...r, compare_item_id: r.item_id })) },
        } as unknown as ComparePayload['runs'][number];
        const mean = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0) / map.size;
        const whole = buildCompareModel({ runs: [payload] } as ComparePayload, ['rr']);
        const [column] = metricColumns(whole, 'run');
        for (const [metric, value] of Object.entries(want.run))
          expect(mean(columnItemScores(whole, column!, metricCtx(whole, metric))), `run ${metric}`).toBeCloseTo(value, 9);
        const each = buildCompareModel({ runs: [payload] } as ComparePayload, ['rr::pass1', 'rr::pass2', 'rr::pass3']);
        const perPass = metricColumns(each, 'each');
        expect(perPass).toHaveLength(Object.keys(want.passes).length);
        perPass.forEach((col, i) => {
          for (const [metric, value] of Object.entries(want.passes[String(i + 1)]!))
            expect(mean(columnItemScores(each, col, metricCtx(each, metric))), `pass ${i + 1} ${metric}`).toBeCloseTo(value, 9);
        });
      });

    if (expected.meta_keys_exclude)
      it('does not offer platform flags as metric fields', () => {
        for (const key of expected.meta_keys_exclude!) expect(model.allMetricMetaKeys).not.toContain(key);
      });

    if (expected.categories)
      it('shows each category group with the item pass weight and the reviewer values', () => {
        const { view_pass: viewPass, groups } = expected.categories!;
        const catCtx = contextOf(golden, viewPass);
        for (const [key, entries] of Object.entries(groups)) {
          for (const [entry, want] of Object.entries(entries)) {
            const at = entry.lastIndexOf(':');
            const value = entry.slice(0, at);
            const metric = entry.slice(at + 1);
            const breakdown = categoryBreakdown(catCtx, catCtx.model.rows, key, metric, null);
            const stat = breakdown?.groups.find((g) => g.value === value);
            expect(stat, `${key} ${entry}`).toBeTruthy();
            expect([stat!.avgScore, stat!.passRate], `${key} ${entry}`).toEqual([
              expect.closeTo(want[0], 9),
              expect.closeTo(want[1], 9),
            ]);
          }
        }
      });

    if (expected.pass_rows)
      it('judges each pass of a repeat item by its own outcome, whichever pass failed last', () => {
        const want = expected.pass_rows!;
        const row = golden.snapshot.rows.find((r) => r.item_id === want.item_id)!;
        const scoped = want.status.map((_, i) => scopeRowToPass(row, model.metricNames, i + 1));
        expect(scoped.map((r) => r.status)).toEqual(want.status);
        for (const metric of Object.keys(want).filter((k) => k !== 'item_id' && k !== 'status')) {
          const idx = model.metricNames.indexOf(metric);
          expect(
            scoped.map((r) => getRowScore(r, idx, metric, direction(metric))),
            metric,
          ).toEqual(want[metric]);
        }
      });

    if (expected.label_verdicts)
      it('classifies errored passes the same from full and index rows', () => {
        for (const [metric, want] of Object.entries(expected.label_verdicts!)) {
          const idx = model.metricNames.indexOf(metric);
          const verdicts = rows.map(
            (row) => isTaskErrorPass(row, metric, 0) || isMetricErrorMeta(row.pass_metric_meta?.[metric]?.[0]),
          );
          expect(verdicts, metric).toEqual(want);
          expect(
            rows.map((row) => getRowScore(row, idx, metric, direction(metric)).isError),
            metric,
          ).toEqual(want);
        }
      });

    if (expected.clean_means)
      it('leaves scorer errors out of "mean without errors" and counts them', () => {
        for (const [metric, want] of Object.entries(expected.clean_means!)) {
          const idx = model.metricNames.indexOf(metric);
          let sum = 0;
          let count = 0;
          let errors = 0;
          for (const row of rows) {
            const c = scoreWithoutMetricErrors(row, idx, metric, direction(metric));
            errors += c.errors;
            if (c.score !== null) {
              sum += c.score;
              count++;
            }
          }
          if (want.score === null) expect(count ? sum / count : null, metric).toBeNull();
          else expect(sum / count, metric).toBeCloseTo(want.score, 9);
          expect(errors, metric).toBe(want.errors);
        }
      });
  });
});
