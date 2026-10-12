import { describe, expect, it } from 'vitest';
import { metricColumns, resolveBaseline } from '../baseline';
import { buildCompareModel } from '../model';
import { buildColumnRows } from '../panelData';
import { makePayload } from './fixtures';

const SPECS = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: { score_type: 'percentage', direction: 'minimize', schema_version: 2 },
};
const errored = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`i${i + 1}`, { correct: i % 2, quality: 'error' as const }]),
  );

describe('Metrics table with a lower-is-better metric every run errored on', () => {
  const payload = makePayload([
    { id: 'A', model: 'm1', scores: errored(4), specs: SPECS },
    { id: 'B', model: 'm2', scores: errored(4), specs: SPECS },
  ]);
  const model = buildCompareModel(payload, ['A', 'B']);
  const columns = metricColumns(model, 'run');
  const rows = buildColumnRows(
    model,
    columns,
    resolveBaseline(columns, null)!,
    new Set(['i1', 'i2', 'i3', 'i4']),
    {},
  );

  it('keeps the metric, with no mean that would read as the best score', () => {
    expect(model.metrics).toContain('quality');
    for (const row of rows) {
      expect(row.metrics.quality!.mean).toBeNull();
      expect(row.metrics.quality!.n).toBe(0);
    }
  });

  it('counts the scorer errors of every run in the Errors column', () => {
    expect(rows.map((r) => [r.taskErrors, r.metricErrors])).toEqual([
      [0, 4],
      [0, 4],
    ]);
  });
});

describe('pass columns name their pass', () => {
  it('"Each pass" gives one column per pass of a repeat run, in order, after the plain run', () => {
    const payload = makePayload([
      { id: 'R', model: 'm1', samples: 3, scores: { i1: { correct: [1, 0, 1], quality: [0.5, 0.6, 0.7] } } },
      { id: 'C', model: 'm2', scores: { i1: { correct: 1, quality: 0.9 } } },
    ]);
    const model = buildCompareModel(payload, ['R', 'C']);
    const cols = metricColumns(model, 'each');
    expect(cols.map((c) => c.key)).toEqual(['R::pass1', 'R::pass2', 'R::pass3', 'C']);
    expect(cols.slice(0, 3).map((c) => c.title.split(' · ').pop())).toEqual(['pass 1', 'pass 2', 'pass 3']);
  });
});
