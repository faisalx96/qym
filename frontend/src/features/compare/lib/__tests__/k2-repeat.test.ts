/** K2 (C037, C062, C215): one repeat run opens on its passes, counts executions and names its passes 'Pass N'. */
import { describe, expect, it } from 'vitest';
import { metricColumns, resolveBaseline } from '../baseline';
import { columnName } from '../columnName';
import { defaultColumns, emptyView, readView, writeView } from '../filters';
import { buildCompareModel } from '../model';
import { runCounts } from '../runInfo';
import { makePayload } from './fixtures';

const scores = {
  i1: { correct: [1, 0, 1], quality: [0.9, 0.4, 0.8] },
  i2: { correct: [0, 0, 1], quality: [0.3, 0.2, 0.9] },
};
const decode = (baseCount: number) => ({
  metrics: ['quality'],
  metadataKeys: [],
  runCount: 3,
  rows: [],
  baseCount,
});

describe('pass columns by default (C037)', () => {
  it('opens on each pass with fewer than two base runs, else on the run average', () => {
    expect(defaultColumns(1)).toBe('each');
    expect(defaultColumns(2)).toBe('run');
    expect(readView(new URLSearchParams(''), decode(1)).columns).toBe('each');
    expect(readView(new URLSearchParams(''), decode(2)).columns).toBe('run');
    expect(readView(new URLSearchParams('columns=run'), decode(1)).columns).toBe('run');
    expect(readView(new URLSearchParams('columns=passes'), decode(2)).columns).toBe('each');
  });

  it('writes no columns key for the default and an explicit one otherwise', () => {
    const each = { ...emptyView(), columns: 'each' as const };
    const run = { ...emptyView(), columns: 'run' as const };
    expect(writeView(each, null, 'each').columns).toBeNull();
    expect(writeView(run, null, 'each').columns).toBe('run');
    expect(writeView(each, null, 'run').columns).toBe('passes');
  });

  it('takes pass 1 as the baseline', () => {
    const payload = makePayload([{ id: 'rep', name: 'support-agent-02645', samples: 3, scores }]);
    const model = buildCompareModel(payload, ['rep']);
    const columns = metricColumns(model, 'each');
    expect(resolveBaseline(columns, null, model)!.key).toBe('rep::pass1');
  });
});

describe("one run's passes go by 'Pass N' (C215)", () => {
  it('labels pass columns Pass 1 to Pass N and the run-average column by the run', () => {
    const payload = makePayload([{ id: 'rep', name: 'support-agent-02645', samples: 3, scores }]);
    const model = buildCompareModel(payload, ['rep']);
    expect(metricColumns(model, 'each').map((c) => columnName(model, c))).toEqual([
      'Pass 1',
      'Pass 2',
      'Pass 3',
    ]);
    expect(metricColumns(model, 'run').map((c) => columnName(model, c))).toEqual(['support-agent-02645']);
  });

  it('keeps the run name on the passes of a repeat run compared with another run', () => {
    const payload = makePayload([
      { id: 'rep', name: 'repeat', samples: 2, scores },
      {
        id: 'one',
        name: 'single',
        scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.3 } },
      },
    ]);
    const model = buildCompareModel(payload, ['rep', 'one']);
    expect(metricColumns(model, 'each').map((c) => columnName(model, c))).toEqual([
      'repeat · pass 1',
      'repeat · pass 2',
      'single',
    ]);
  });
});

describe('a repeat run counts executions (C062)', () => {
  it('counts every pass once, so the counts add up', () => {
    const payload = makePayload([{ id: 'rep', samples: 3, scores }]);
    const rows = payload.runs[0]!.snapshot.rows!;
    rows[0]!.execution_error_count = 1;
    rows[1]!.execution_error_count = 2;
    expect(runCounts(payload.runs[0]!).executions).toEqual({ total: 6, succeeded: 3, errors: 3, passes: 3 });
  });

  it('keeps item counts for a single-pass run', () => {
    const payload = makePayload([{ id: 'one', scores: { i1: { correct: 1, quality: 0.9 } } }]);
    expect(runCounts(payload.runs[0]!).executions).toBeNull();
  });
});
