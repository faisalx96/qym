import { describe, expect, it } from 'vitest';
import { effectiveThresholds, emptyView, type FilterContext } from '../filterRules';
import { metricCardModel } from '../overviewModel';
import { buildRunModel } from '../runModel';
import type { Row, RunPayload } from '../../types';

function contextOf(specs: Record<string, Record<string, unknown>>, rows: Row[]): FilterContext {
  const names = Object.keys(specs);
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples: 1, metric_names: names, metric_specs: specs },
    snapshot: { rows, metric_names: names, metric_specs: specs },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  return {
    model,
    thresholds: effectiveThresholds(model, emptyView()),
    selectedMetric: names[0]!,
    repeatAggregate: false,
  };
}

const row = (i: number, values: Array<number | ''>, over: Partial<Row> = {}): Row =>
  ({
    index: i,
    item_id: `item-${i}`,
    status: 'completed',
    error: '',
    metric_values: values,
    metric_meta: {},
    ...over,
  }) as Row;

describe('metric cards say what an error did to the mean', () => {
  it('a maximize and an undeclared card say a failed task counts as 0', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      i === 4 ? row(i, ['', ''], { status: 'error', error: 'task boom' }) : row(i, [0.5 + 0.05 * i, 3 + i]),
    );
    const ctx = contextOf(
      {
        accuracy: { score_type: 'percentage', direction: 'maximize', schema_version: 2 },
        count: { score_type: 'number', schema_version: 2 },
      },
      rows,
    );
    const accuracy = metricCardModel(ctx, rows, 'accuracy')!;
    expect(accuracy.errorNote!.text.endsWith('1 task error · counted as 0%')).toBe(true);
    const count = metricCardModel(ctx, rows, 'count')!;
    expect(count.errorNote!.text.endsWith('1 task error · counted as 0')).toBe(true);
    expect(count.errorNote!.title).toContain('in Min');
  });

  it('a lower-is-better scorer error is left out of the mean, never shown as the best score', () => {
    const rows = [
      row(0, [0.4]),
      row(1, [0.2]),
      row(2, [0], { metric_meta: { h: { status: 'error', error: 'judge 429' } } }),
    ];
    const ctx = contextOf(
      { h: { score_type: 'percentage', direction: 'minimize', schema_version: 2 } },
      rows,
    );
    const card = metricCardModel(ctx, rows, 'h')!;
    expect(card.avg).toBeCloseTo(0.3);
    expect(card.errorNote!.text).toContain('not counted in the mean');
    expect(card.errorNote!.title).toContain('would read as its best score');
  });

  it('a lower-is-better card whose every row errored is still shown, with no mean', () => {
    const rows = [0, 1, 2].map((i) =>
      row(i, [0], { metric_meta: { h: { status: 'error', error: 'judge 429' } } }),
    );
    const ctx = contextOf(
      { h: { score_type: 'percentage', direction: 'minimize', schema_version: 2 } },
      rows,
    );
    const card = metricCardModel(ctx, rows, 'h');
    expect(card).not.toBeNull();
    expect(card!.avg).toBeNull();
    expect(card!.avgText).toBe('—');
    expect(card!.errorNote!.text).toContain('3 errors');
  });
});
