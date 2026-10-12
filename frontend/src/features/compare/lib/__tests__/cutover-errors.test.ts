/**
 * Cutover of tests/platform/test_compare_error_counts.py (the vanilla Compare card renderers ran
 * against task / metric / pass error fixtures): how a task error, a scorer error and a judged zero
 * read on each run's cell, in the pass slices, in the failed counts and in the error buckets.
 */
import { describe, expect, it } from 'vitest';
import { isErrorRow, isItemTaskError, hasMetricError } from '@/lib/metrics';
import { collectErrors } from '@/features/run-detail/lib/rowErrors';
import { runCounts } from '@/features/run-detail/lib/overviewModel';
import type { Row } from '@/features/run-detail/types';
import { buildCompareModel, slicePayloadToPass, type ComparePayload } from '../model';
import { metricCellFor } from '../rowCells';
import { metricCtx } from '../scoring';
import { computeComparisonStats } from '../stats';
import { pillState } from '../rowCells';
import { errorDistribution } from '../breakdown';
import { metricColumns } from '../baseline';

const SPECS = {
  accuracy: { score_type: 'boolean', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
  quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
};

function row(over: Partial<Row> = {}): Row {
  return {
    index: 2,
    item_id: 'item_2',
    compare_item_id: 'item_2',
    status: 'completed',
    input: 'Task completed; metric crashed',
    output: 'SELECT 4',
    metric_values: [0, 1],
    metric_meta: { accuracy: { status: 'error', error: 'Judge unavailable' } },
    ...over,
  } as Row;
}

function run(
  id: string,
  rows: Array<Row | null>,
  specs: Record<string, Record<string, unknown>> = SPECS,
  samples = 1,
) {
  return {
    run: {
      run_id: id,
      file_path: id,
      run_name: id,
      model_name: id,
      metric_names: ['accuracy', 'quality'],
      metric_specs: specs,
      status: 'COMPLETED',
      samples,
      config: { samples },
      metadata: {},
    },
    snapshot: {
      rows: rows.filter(Boolean) as Row[],
      metric_names: ['accuracy', 'quality'],
      metric_specs: specs,
    },
  } as unknown as ComparePayload['runs'][number];
}

const model = (runs: ComparePayload['runs'], refs?: string[]) =>
  buildCompareModel(
    { runs, compare_alignment_status: 'aligned', unalignable_runs: [], missing_runs: [] },
    refs ?? runs.map((r) => r.run.run_id),
  );

describe('a metric error marks only its own surfaces', () => {
  const cases: Array<[string, number | null, Record<string, unknown>]> = [];
  for (const type of ['boolean', 'percentage', 'number'])
    for (const score of [0, null])
      for (const meta of [
        { status: 'error', error: 'Judge unavailable' },
        { status: 'timeout' },
        // meta.error alone is a verdict reason (C010); the status is the signal.
        { status: 'failed', error: 'Legacy metric exception' },
      ])
        cases.push([type, score, meta]);

  it.each(cases)('%s metric, score %s, %j', (type, score, meta) => {
    const specs = { ...SPECS, accuracy: { ...SPECS.accuracy, score_type: type } };
    const r = row({ metric_values: [score as number, 1], metric_meta: { accuracy: meta } });
    const m = model([run('A', [r], specs)]);
    const column = m.runs[0]!;
    const accuracy = metricCellFor(m, column, r, 'accuracy');
    const quality = metricCellFor(m, column, r, 'quality');
    // The scorer error belongs to accuracy; the task and the other metric are clean.
    expect(accuracy.error).toBe('metric');
    expect(quality.error).toBeNull();
    expect(isItemTaskError(r)).toBe(false);
    expect(hasMetricError(r, 'accuracy')).toBe(true);
    expect(hasMetricError(r, 'quality')).toBe(false);
    // The row counts as one failure.
    expect(isErrorRow(r)).toBe(true);
    // Higher is better: the error counts as 0, a fail (C015) ...
    expect(pillState(column, r, metricCtx(m, 'accuracy')).state).toBe('fail');
  });

  it('lower is better: the error is left out and the pill says error, never a pass', () => {
    const specs = { ...SPECS, accuracy: { ...SPECS.accuracy, direction: 'minimize' } };
    const r = row({
      metric_values: [0, 1],
      metric_meta: { accuracy: { status: 'error', error: 'Judge unavailable' } },
    });
    const m = model([run('A', [r], specs)]);
    expect(pillState(m.runs[0]!, r, metricCtx(m, 'accuracy')).state).toBe('error');
  });
});

describe('a judged zero without an exception keeps its display', () => {
  const display: Record<string, string> = { boolean: 'False', percentage: '0.0%', number: '0' };
  const cases: Array<[string, unknown]> = [];
  for (const type of ['boolean', 'percentage', 'number'])
    for (const error of [null, false, 0, '', '   ', 'Empty output']) cases.push([type, error]);
  it.each(cases)('%s with meta.error %j', (type, error) => {
    const specs = { ...SPECS, accuracy: { ...SPECS.accuracy, score_type: type } };
    const r = row({ metric_meta: { accuracy: { label: 'failed', error } } });
    const m = model([run('A', [r], specs)]);
    const cell = metricCellFor(m, m.runs[0]!, r, 'accuracy');
    expect(cell.text).toBe(display[type]);
    expect(cell.error).toBeNull();
    expect(hasMetricError(r, 'accuracy')).toBe(false);
    expect(isErrorRow(r)).toBe(false);
  });
});

describe('metric errors of a metric that is not the selected one', () => {
  it('stay on their own metric and still count the row as failed', () => {
    const r = row();
    const m = model([run('A', [r])]);
    expect(metricCellFor(m, m.runs[0]!, r, 'quality').error).toBeNull();
    expect(metricCellFor(m, m.runs[0]!, r, 'accuracy').error).toBe('metric');
    expect(isErrorRow(r)).toBe(true);
    // A failed verdict without an exception is a fail, not an error.
    const judged = row({ metric_meta: { accuracy: { label: 'failed' } } });
    expect(hasMetricError(judged, 'accuracy')).toBe(false);
    expect(isErrorRow(judged)).toBe(false);
  });
});

describe('mixed task and metric errors are scoped to their own run', () => {
  it('marks the task error on run 1 only, the metric error on run 2 only, and run 3 has no data', () => {
    const taskFailed = row({ status: 'error', output: 'Task rejected', metric_meta: {}, metric_values: [] });
    const metricFailed = row();
    const m = model([run('A', [taskFailed]), run('B', [metricFailed]), run('C', [])]);
    expect(isItemTaskError(taskFailed)).toBe(true);
    expect(metricCellFor(m, m.runs[0]!, taskFailed, 'accuracy').error).toBe('task');
    expect(isItemTaskError(metricFailed)).toBe(false);
    expect(metricCellFor(m, m.runs[1]!, metricFailed, 'accuracy').error).toBe('metric');
    expect(m.runs[2]!.byItem.get('item_2')).toBeUndefined();
    // Two failed rows overall.
    expect([taskFailed, metricFailed].filter((r) => isErrorRow(r)).length).toBe(2);
  });
});

describe('a pass does not leak another pass error', () => {
  it('slices a repeat run so each pass keeps only its own task and scorer error', () => {
    const source = run(
      'r',
      [
        row({
          status: 'error',
          pass_attempts: [
            { pass_number: 1, status: 'error' },
            { pass_number: 2, status: 'completed', output: 'SELECT 4' },
            { pass_number: 3, status: 'completed', output: 'SELECT 4' },
          ] as Row['pass_attempts'],
          pass_scores: { accuracy: [0, 0, 1], quality: [0, 1, 1] },
          pass_metric_meta: {
            accuracy: [{ label: 'error' }, { status: 'error', error: 'Judge crashed' }, {}],
            quality: [{ label: 'error' }, {}, {}],
          },
        } as Partial<Row>),
      ],
      SPECS,
      3,
    );
    const slices = [1, 2, 3].map((p) => slicePayloadToPass(source as never, `r::pass${p}`, p));
    const rows = slices.map((s) => s.snapshot.rows[0]!);
    expect(rows.map((r) => isItemTaskError(r))).toEqual([true, false, false]);
    expect(rows.map((r) => hasMetricError(r, 'accuracy'))).toEqual([false, true, false]);
    // Pass 3 passes accuracy: the other passes' errors do not touch it.
    const m = model([source], ['r::pass1', 'r::pass2', 'r::pass3']);
    expect(pillState(m.runs[2]!, m.runs[2]!.byItem.get('item_2')!, metricCtx(m, 'accuracy')).state).toBe(
      'pass',
    );
    expect(slices.map((s) => s.snapshot.stats?.failed)).toEqual([1, 0, 0]);
  });

  it('slicing never changes the parent run', () => {
    const parent = run(
      'run',
      [
        row({
          item_id: 'a',
          compare_item_id: 'a',
          status: 'error',
          pass_scores: { accuracy: [1, 0, null] },
        } as Partial<Row>),
        row({
          item_id: 'b',
          compare_item_id: 'b',
          status: 'error',
          pass_scores: { accuracy: [0, 0, null] },
        } as Partial<Row>),
      ],
      SPECS,
      3,
    );
    const before = JSON.stringify(parent);
    for (const p of [1, 2, 3]) slicePayloadToPass(parent as never, `run::pass${p}`, p);
    expect(JSON.stringify(parent)).toBe(before);
  });
});

describe('failed counts count each errored item once and "completed" means finished', () => {
  it('summarises a mix of task errors, metric errors and unfinished items', () => {
    const meta = { status: 'error', error: 'Metric unavailable' };
    const rows = [
      { status: 'completed', metric_values: [1] },
      { status: 'completed', metric_values: [0], metric_meta: { accuracy: { label: 'failed' } } },
      { status: 'completed', metric_values: [0, 0], metric_meta: { accuracy: meta, quality: meta } },
      { status: 'error', error: 'Task failed', metric_meta: { accuracy: meta } },
      { status: 'failed', error: 'Task timed out' },
      { status: 'pending' },
      { status: 'in_progress' },
    ] as unknown as Row[];
    const counts = runCounts(rows, false);
    expect({ total: counts.total, completed: counts.completed, failed: counts.errors }).toEqual({
      total: 7,
      completed: 5,
      failed: 3,
    });
    const empty = runCounts([], false);
    expect({ total: empty.total, completed: empty.completed, failed: empty.errors }).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
    });
    // A trace/provider warning alone is not a task or metric exception.
    expect(
      runCounts([{ status: 'completed', trace_stats: { provider_errors: 2 } } as unknown as Row], false)
        .errors,
    ).toBe(0);
  });

  it.each(['accuracy', 'quality', 'missing'])('3 + 3 failures equal the overview for %s', (metric) => {
    const fixture = (id: string) =>
      run(id, [
        { compare_item_id: 'pass', item_id: 'pass', status: 'completed', metric_values: [1, 1] },
        { compare_item_id: 'judge', item_id: 'judge', status: 'completed', metric_values: [0, 0] },
        {
          compare_item_id: 'metric',
          item_id: 'metric',
          status: 'completed',
          metric_values: [0, 1],
          metric_meta: { accuracy: { status: 'error' } },
        },
        { compare_item_id: 'task', item_id: 'task', status: 'error', metric_values: [] },
        { compare_item_id: 'timeout', item_id: 'timeout', status: 'error', metric_values: [] },
      ] as unknown as Row[]);
    const m = model([fixture('A'), fixture('B')]);
    const perRun = m.runs.map((r) => r.rows.filter((x) => isErrorRow(x)).length);
    expect(perRun).toEqual([3, 3]);
    const ctx = metricCtx(m, metric);
    const overview = computeComparisonStats(m, ctx);
    expect(overview.failedCount).toBe(6);
    expect(overview.failedCount).toBe(perRun.reduce((a, b) => a + b, 0));
    expect(computeComparisonStats(m, ctx, ['metric']).failedCount).toBe(2);
    expect(computeComparisonStats(m, ctx, ['judge']).failedCount).toBe(0);
    if (metric === 'accuracy') expect(overview.overallAvgScore).toBeCloseTo(0.2, 9);
    if (metric === 'quality') expect(overview.overallAvgScore).toBeCloseTo(0.4, 9);
  });
});

describe('error buckets', () => {
  it('count a metric error per pass and task errors once per row, filtering kinds separately', () => {
    const metricRow = {
      item_id: 'a',
      status: 'completed',
      metric_meta: { accuracy: { status: 'timeout', error: 'Provider timed out' } },
    } as unknown as Row;
    const buckets = collectErrors(
      [
        metricRow,
        metricRow,
        { item_id: 'b', status: 'error', error: 'Task failed' },
        { item_id: 'b', status: 'error', error: 'Task failed' },
        { item_id: 'c', status: 'failed', error: 'Task failed' },
        { item_id: 'c', status: 'failed', error: 'Task failed' },
        { item_id: 'judge', status: 'completed', metric_meta: { accuracy: { label: 'failed' } } },
      ] as unknown as Row[],
      false,
    );
    const entries = Array.from(buckets.values());
    expect(entries.reduce((sum, e) => sum + e.count, 0)).toBe(6);
    const metric = entries.find((e) => e.kind === 'Metric error')!;
    expect(metric.count).toBe(2);
    expect(metric.itemIds.size).toBe(1);
  });

  it('the Errors tab lists every kind per compared column', () => {
    const failed = row({
      status: 'error',
      error: 'Task failed',
      metric_meta: { accuracy: { status: 'error', error: 'Parser unavailable' } },
    });
    const m = model([run('A', [failed]), run('B', [row({ metric_meta: {} })])]);
    const entries = errorDistribution(m, metricColumns(m, 'run'), [{ itemId: 'item_2' }]);
    expect(entries.map((e) => [e.kind, e.counts]).sort()).toEqual([
      ['Metric error', [1, 0]],
      ['Task error', [1, 0]],
    ]);
  });
});

describe('error groups appear only when the filtered results contain them (run and compare)', () => {
  const good = { item_id: 'good', status: 'completed', metric_values: [0] } as unknown as Row;
  const task = { item_id: 'task', status: 'error', error: 'HTTPError: Bad request' } as unknown as Row;
  const metric = {
    item_id: 'metric',
    status: 'completed',
    metric_meta: { accuracy: { status: 'error', error: 'Judge timed out' } },
  } as unknown as Row;
  const trace = {
    item_id: 'trace',
    status: 'completed',
    trace_stats: { provider_errors: 2 },
  } as unknown as Row;
  const analysis = {
    item_id: 'analysis',
    status: 'completed',
    item_metadata: { analysis_error: 'accuracy: Context limit exceeded' },
  } as unknown as Row;
  const kinds = (rows: Row[]) => [
    ...new Set(Array.from(collectErrors(rows, false).values()).map((b) => b.kind)),
  ];

  it('run page: only the kinds present in the rows, in a stable order', () => {
    expect(kinds([])).toEqual([]);
    expect(kinds([good])).toEqual([]);
    for (const [row, kind] of [
      [task, 'Task error'],
      [metric, 'Metric error'],
      [trace, 'Trace error'],
      [analysis, 'Analysis error'],
    ] as Array<[Row, string]>)
      expect(kinds([good, row])).toEqual([kind]);
    // Same shape as the screenshot: 28 analysis errors and no other kinds.
    const many = Array.from({ length: 28 }, (_, i) => ({ ...analysis, item_id: `analysis-${i}` }) as Row);
    const buckets = Array.from(collectErrors(many, false).values());
    expect(buckets.map((b) => [b.kind, b.count])).toEqual([['Analysis error', 28]]);
    expect(kinds([good, task, metric, trace, analysis]).sort()).toEqual(
      ['Analysis error', 'Metric error', 'Task error', 'Trace error'].sort(),
    );
  });

  it('compare: the Errors tab reads the filtered items only', () => {
    const rows = [good, task, metric, trace, analysis].map(
      (r) => ({ ...r, compare_item_id: r.item_id }) as Row,
    );
    const m = model([run('A', rows)]);
    const columns = metricColumns(m, 'run');
    const of = (ids: string[]) =>
      errorDistribution(
        m,
        columns,
        ids.map((itemId) => ({ itemId })),
      );
    expect(of([])).toEqual([]);
    expect(of(['good'])).toEqual([]);
    expect(of(['good', 'task']).map((e) => e.kind)).toEqual(['Task error']);
    expect(of(['analysis']).map((e) => e.kind)).toEqual(['Analysis error']);
    expect(new Set(of(['good', 'task', 'metric', 'trace', 'analysis']).map((e) => e.kind))).toEqual(
      new Set(['Task error', 'Metric error', 'Trace error', 'Analysis error']),
    );
  });
});
