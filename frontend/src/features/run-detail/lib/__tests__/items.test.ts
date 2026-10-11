import { describe, expect, it } from 'vitest';
import { activeChips } from '../activeChips';
import { buildCsv, csvEscape, discoverColumns } from '../csv';
import { buildFieldDefs, effectiveThresholds, emptyView } from '../filterRules';
import { metricCell, rowStatus } from '../rowDisplay';
import { buildRunModel } from '../runModel';
import { bodyText, itemLink } from '../itemText';
import { collectOutputValues } from '../../hooks/useItemSearch';
import type { Row, RunPayload } from '../../types';

const specs = {
  ok: { score_type: 'boolean', direction: 'maximize', schema_version: 2 },
  q: {
    score_type: 'percentage',
    direction: 'maximize',
    pass_threshold: 0.7,
    primary: true,
    schema_version: 2,
  },
};
const rows: Row[] = [
  {
    index: 0,
    item_id: 'a',
    status: 'completed',
    metric_values: [1, 0.9],
    item_metadata: { domain: 'x' },
    input_preview: 'hi, "there"',
    latency_ms: 10,
  },
  {
    index: 1,
    item_id: 'b',
    status: 'completed',
    metric_values: [0, 0.2],
    metric_meta: { q: { reason: 'bad' } },
  },
  { index: 2, item_id: 'c', status: 'error', error: 'boom', metric_values: ['', ''] },
  { index: 3, item_id: 'd', status: 'not_received', metric_values: ['', ''] },
] as Row[];
const payload: RunPayload = {
  run: { run_id: 'r', status: 'COMPLETED', metric_names: ['ok', 'q'], metric_specs: specs, samples: 1 },
  snapshot: { rows, metric_names: ['ok', 'q'], metric_specs: specs },
};
const model = buildRunModel(payload, null);
const view = emptyView();
const ctx = {
  model,
  thresholds: effectiveThresholds(model, view),
  selectedMetric: 'q',
  repeatAggregate: false,
};

describe('row display', () => {
  it('derives status and metric cells', () => {
    expect(rowStatus(ctx, rows[0]!, 'q').kind).toBe('pass');
    expect(rowStatus(ctx, rows[1]!, 'q').kind).toBe('fail');
    expect(rowStatus(ctx, rows[2]!, 'q').kind).toBe('error');
    expect(rowStatus(ctx, rows[3]!, 'q').kind).toBe('not_received');
    expect(metricCell(ctx, rows[0]!, 'ok').text).toBe('True');
    expect(metricCell(ctx, rows[0]!, 'q').text).toBe('90.0%');
    expect(metricCell(ctx, rows[2]!, 'q').error).toBe('task');
    expect(metricCell(ctx, rows[3]!, 'q').value).toBeNull();
  });
});

describe('active chips', () => {
  it('lists page filters and removes each one', () => {
    const defs = buildFieldDefs(ctx);
    const v = {
      ...view,
      show: 'failed' as const,
      filters: {
        ...view.filters,
        latency: { min: 2000, max: Infinity },
        errors: { task: { kind: 'Task error', label: 'boom' } },
        categories: { domain: ['x'] },
      },
    };
    const chips = activeChips(v, defs, 'q');
    expect(chips.map((c) => c.key)).toEqual(['show', 'error:task', 'latency', 'cat:domain']);
    expect(chips[0]!.label).toBe('Failing · q');
    const cleared = chips.reduce((acc, c) => c.clear(acc), v);
    expect(cleared.show).toBe('all');
    expect(cleared.filters.latency).toBeNull();
    expect(cleared.filters.errors).toEqual({});
    expect(cleared.filters.categories).toEqual({});
    expect(activeChips(view, defs, 'q')).toEqual([]);
  });
});

describe('csv', () => {
  it('escapes and builds with discovered columns', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    const cols = discoverColumns(rows, model);
    expect(cols.map((c) => c.id)).toContain('q.reason');
    expect(cols.map((c) => c.id)).toContain('meta.domain');
    const csv = buildCsv(
      cols.filter((c) => ['index', 'input', 'q.score', 'q.reason'].includes(c.id)),
      rows,
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('index,input,q,q.reason');
    expect(lines[1]).toBe('1,"hi, ""there""",0.9,');
    expect(lines[2]).toBe('2,,0.2,bad');
  });
});

describe('helpers', () => {
  it('formats bodies and links', () => {
    expect(bodyText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(bodyText(null)).toBe('');
    expect(itemLink('/app/projects/p/runs/r', 'i 1', 2, 'http://h')).toBe(
      'http://h/app/projects/p/runs/r?item=i+1&pass=2',
    );
    expect(
      collectOutputValues({
        op: 'and',
        children: [
          { field: 'output', oper: 'contains', value: 'x' },
          { op: 'or', children: [{ field: 'output', oper: 'contains', value: 'y' }] },
        ],
      }),
    ).toEqual(['x', 'y']);
  });
});
