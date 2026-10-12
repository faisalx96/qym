/**
 * Cutover of test_minimize_errors_browser.py (run page) and test_metric_semantics_browser.py (C008 / C015):
 * the run page's cards, segments and verdicts follow the declared direction. Lower-is-better metrics
 * leave errors out of the mean and never read an errored item as a pass; a metric without a direction
 * is shown neutrally (no Pass / Fail, no verdict).
 */
import { describe, expect, it } from 'vitest';
import { buildRunModel } from '../runModel';
import {
  applyItemFilters,
  buildFieldDefs,
  effectiveThresholds,
  emptyView,
  type FilterContext,
} from '../filterRules';
import { metricCardModel } from '../overviewModel';
import { rowStatus } from '../rowDisplay';
import type { Row, RunPayload } from '../../types';

const ctxOf = (rows: Row[], specs: Record<string, Record<string, unknown>>): FilterContext => {
  const names = Object.keys(specs);
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples: 1, metric_names: names, metric_specs: specs },
    snapshot: { rows, metric_names: names, metric_specs: specs },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  return {
    model,
    thresholds: effectiveThresholds(model, emptyView()),
    selectedMetric: model.defaultMetric,
    repeatAggregate: false,
  };
};

const MINIMIZE_BOOL = {
  accuracy: { score_type: 'boolean', direction: 'minimize', schema_version: 2 },
  count: { score_type: 'number', direction: 'maximize' },
};

/** accuracy is lower-is-better: items 1, 2 scorer errors, 4 a task error, 5 and 6 True, the rest False. */
function boolRows(): Row[] {
  return Array.from({ length: 10 }, (_, i) => {
    const row = {
      index: i,
      item_id: `item-${i}`,
      status: i === 4 ? 'error' : 'completed',
      error: i === 4 ? 'task boom' : '',
      metric_values: [i === 4 ? '' : i === 5 || i === 6 ? 1 : 0, i],
      metric_meta: i === 1 || i === 2 ? { accuracy: { status: 'error', error: 'judge 429' } } : {},
      item_metadata: {},
    };
    return row as unknown as Row;
  });
}

describe('a lower-is-better boolean metric with errors (C008 x C015)', () => {
  const ctx = ctxOf(boolRows(), MINIMIZE_BOOL);
  const rows = ctx.model.rows;
  const card = metricCardModel(ctx, rows, 'accuracy')!;

  it('an errored item sits in one segment only and the legend says what errors count as', () => {
    expect(Object.fromEntries(card.segments!.map((x) => [x.key, x.count]))).toEqual({
      passed: 5,
      failed: 2,
      metric_errors: 3,
    });
    expect(card.segments!.map((x) => x.label)).toEqual(['Pass (False)', 'Fail (True)', 'Error']);
    expect(card.errorLegend!.label).toBe('not counted in the mean');
    // 2 True of the 7 items without an error
    expect(card.avgText).toBe('28.6%');
    expect(card.errorNote!.text.endsWith('3 errors · not counted in the mean')).toBe(true);
    expect(card.errorNote!.title).toContain('2 scorer errors and 1 task error are not counted');
  });

  it('each segment filters exactly the items it counts', () => {
    const defs = buildFieldDefs(ctx);
    const listed = (show: 'passed' | 'failed' | 'metric_errors') =>
      applyItemFilters(ctx, { ...emptyView(), show, metric: 'accuracy' }, defs)
        .map((i) => i.row.index)
        .sort((a, b) => a - b);
    expect({ passed: listed('passed'), failed: listed('failed'), errors: listed('metric_errors') }).toEqual({
      passed: [0, 3, 7, 8, 9],
      failed: [5, 6],
      errors: [1, 2, 4],
    });
  });

  it('an errored item never reads as a pass on its row', () => {
    const kinds = rows.map((r) => rowStatus(ctx, r, 'accuracy').kind);
    expect(kinds[1]).toBe('error');
    expect(kinds[2]).toBe('error');
    expect(kinds[4]).toBe('error');
    expect(kinds.filter((k) => k === 'pass')).toHaveLength(5);
  });
});

describe('a lower-is-better score histogram', () => {
  const specs = {
    accuracy: { score_type: 'percentage', direction: 'minimize', schema_version: 2 },
    count: { score_type: 'number', direction: 'maximize' },
  };
  const rowsWith = (errored: (i: number) => boolean, total: number) =>
    Array.from({ length: total }, (_, i) => ({
      index: i,
      item_id: `item-${i}`,
      status: 'completed',
      metric_values: [errored(i) ? 0 : 0.55, i],
      metric_meta: errored(i) ? { accuracy: { status: 'error', error: 'judge 429' } } : {},
    })) as unknown as Row[];

  it('keeps errors out of the best bucket and the mean', () => {
    const ctx = ctxOf(
      rowsWith((i) => i >= 1 && i <= 3, 10),
      specs,
    );
    const card = metricCardModel(ctx, ctx.model.rows, 'accuracy')!;
    expect(card.avgText).toBe('55.0%');
    expect(card.errorNote!.text.endsWith('3 errors · not counted in the mean')).toBe(true);
    // the 0% bucket (the best for this metric) holds no errored item, so it is empty and no filter
    expect(card.buckets![0]!.count).toBe(0);
    expect(card.buckets!.every((b) => b.scorerErrors === 0)).toBe(true);
    expect(card.badge).toBe('7 scored · 3 err');
  });

  it('keeps the card when every item errored, with no mean (0 would read as best)', () => {
    const ctx = ctxOf(
      rowsWith(() => true, 4),
      specs,
    );
    const card = metricCardModel(ctx, ctx.model.rows, 'accuracy')!;
    expect(card.avgText).toBe('—');
    expect(card.errorNote!.text.endsWith('4 errors · not counted in the mean')).toBe(true);
  });
});

describe('a metric without a declared direction is neutral (C008)', () => {
  const specs = { accuracy: { score_type: 'boolean' }, count: { score_type: 'number' } };
  const rows = Array.from({ length: 6 }, (_, i) => ({
    index: i,
    item_id: `item-${i}`,
    status: 'completed',
    metric_values: [i % 2, i],
    metric_meta: {},
  })) as unknown as Row[];
  const ctx = ctxOf(rows, specs);

  it('the card shows True / False counts, not Pass / Fail, and says no direction is declared', () => {
    const card = metricCardModel(ctx, ctx.model.rows, 'accuracy')!;
    expect(card.segments!.map((x) => x.label)).toEqual(['True', 'False']);
    expect(card.directionLabel).toMatch(/No direction declared/);
  });

  it('no row reads Pass or Fail', () => {
    const kinds = ctx.model.rows.map((r) => rowStatus(ctx, r, 'accuracy').kind);
    expect(new Set(kinds)).toEqual(new Set(['done']));
  });

  it('opens on the declared primary metric, and says Pass (False) / Fail (True) for a lower-is-better boolean', () => {
    const primary = ctxOf(boolRows(), {
      accuracy: { score_type: 'boolean', direction: 'minimize' },
      count: { score_type: 'number', direction: 'maximize', primary: true },
    });
    expect(primary.model.defaultMetric).toBe('count');
    const labels = metricCardModel(primary, primary.model.rows, 'accuracy')!.segments!.map((x) => x.label);
    expect(labels.slice(0, 2)).toEqual(['Pass (False)', 'Fail (True)']);
  });
});

describe('category metadata without scores has no performance report (test_report_section_visibility_browser.py)', () => {
  it('run: no category breakdown when no item has a score', async () => {
    const { categoryBreakdown } = await import('../overviewModel');
    const rows = Array.from({ length: 4 }, (_, i) => ({
      index: i,
      item_id: `item-${i}`,
      status: 'completed',
      metric_values: ['', ''],
      metric_meta: {},
      item_metadata: { domain: 'finance' },
    })) as unknown as Row[];
    const ctx = ctxOf(rows, {
      accuracy: { score_type: 'percentage', direction: 'maximize' },
      count: { score_type: 'number' },
    });
    expect(categoryBreakdown(ctx, ctx.model.rows, 'domain', 'accuracy', null)).toBeNull();
  });
});
