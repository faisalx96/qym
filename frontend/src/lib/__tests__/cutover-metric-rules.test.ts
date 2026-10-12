/**
 * Cutover of the Node harnesses that ran the deleted vanilla metrics.js:
 * test_metric_semantics.py, test_score_edit_validation.py, test_minimize_errors.py,
 * test_repeat_review_semantics.py. The server-side tables are golden files that the pytest
 * side proves unchanged (tests/platform/fixtures/golden).
 */
import { describe, expect, it } from 'vitest';
import directions from '../../../../tests/platform/fixtures/golden/metric_direction_cases.json';
import scoreEdits from '../../../../tests/platform/fixtures/golden/score_edit_cases.json';
import {
  bestMetricIndexes,
  compareMetricValues,
  defaultMetricName,
  defaultPassThreshold,
  getMetricColorClass,
  getRowScore,
  hasMetricError,
  isErrorRow,
  isInternalMetaKey,
  isMetricErrorMeta,
  isTaskErrorRow,
  metricDeltaVerdict,
  metricMetaDisplayKey,
  metricDirection,
  metricPasses,
  parseMetricScoreInput,
  rowMetricErrorCounts,
  type MetricRow,
  type MetricSpec,
} from '../metrics';
import { mergeMetricNames } from '@/features/compare/lib/model';

describe('the declared direction (C008): the client reads what the server reads', () => {
  it.each(directions.cases as Array<[MetricSpec | null, string | null]>)('%j -> %s', (spec, expected) => {
    expect(metricDirection(spec)).toBe(expected);
  });
});

describe('metric semantics helpers (C008)', () => {
  it('the default metric is the declared primary, else the first by position', () => {
    expect(defaultMetricName(['spider2', 'output_empty'], {})).toBe('spider2');
    expect(defaultMetricName(['output_empty', 'spider2'], { spider2: { primary: true } })).toBe('spider2');
    expect(defaultMetricName([], {})).toBeNull();
    expect(defaultMetricName(['a', 'b'], {})).toBe('a');
    expect(defaultMetricName(['a', 'b'], { b: { primary: true } })).toBe('b');
    expect(defaultMetricName(['a', 'b'], { b: { primary: false } })).toBe('a');
    expect(
      mergeMetricNames([
        ['b', 'a'],
        ['a', 'c'],
      ]),
    ).toEqual(['b', 'a', 'c']);
  });

  it('best and compare follow the direction; none without one', () => {
    expect(bestMetricIndexes([0.015, 0.007, null], 'minimize')).toEqual([1]);
    expect(bestMetricIndexes([0.015, 0.007], 'maximize')).toEqual([0]);
    expect(bestMetricIndexes([0.2, 0.2], 'maximize')).toEqual([0, 1]);
    expect(bestMetricIndexes([0.015, 0.007], null)).toEqual([]);
    expect(compareMetricValues(0.1, 0.2, 'minimize')).toBe(1);
    expect(compareMetricValues(0.1, 0.2, null)).toBe(0);
  });

  it('pass/fail: booleans pass on True (maximize) or False (minimize); defaults by direction', () => {
    expect(metricPasses(1, 0.8, 'maximize', true)).toBe(true);
    expect(metricPasses(0, 0.8, 'minimize', true)).toBe(true);
    expect(metricPasses(1, 0.8, 'minimize', true)).toBe(false);
    expect(metricPasses(0.1, 0.2, 'minimize')).toBe(true);
    expect(metricPasses(0.9, 0.8, null)).toBeNull();
    expect(defaultPassThreshold({ direction: 'minimize', score_type: 'percentage' })).toBe(0.2);
    expect(defaultPassThreshold({ pass_threshold: 0.3 })).toBe(0.3);
    expect(defaultPassThreshold(null, null)).toBe(0.8);
  });

  it('colours are inverted for lower-is-better and absent without a direction', () => {
    expect(getMetricColorClass(0.015, 'score', 'minimize')).toBe('score-5');
    expect(getMetricColorClass(0.015, 'score', 'maximize')).toBe('score-1');
    expect(getMetricColorClass(0.015, 'score', null)).toBe('');
    expect(getMetricColorClass(5, 'numeric', 'maximize')).toBe('');
  });

  it('Sweep verdicts: a drop in a lower-is-better rate is an improvement', () => {
    expect(metricDeltaVerdict(-0.026, 0.01, 'minimize')).toBe('improved');
    expect(metricDeltaVerdict(-0.026, 0.01, 'maximize')).toBe('regressed');
    expect(metricDeltaVerdict(-0.026, 0.01, null)).toBe('changed');
    expect(metricDeltaVerdict(0.005, 0.01, 'minimize')).toBe('within_noise');
  });
});

describe('manual score edits are validated like the server (C009)', () => {
  const run = (raw: unknown, type: string | null, reduced = false) =>
    parseMetricScoreInput(
      raw as string,
      type ? { score_type: type } : null,
      reduced ? { reduced: true } : {},
    );

  it.each(
    scoreEdits.cases as Array<{
      raw: unknown;
      score_type: string | null;
      expected: { value?: number; error?: string };
    }>,
  )('$raw as $score_type', ({ raw, score_type, expected }) => {
    const outcome = run(raw, score_type);
    if (expected.error !== undefined) expect(outcome).toEqual({ ok: false, message: expected.error });
    else {
      expect(outcome.ok).toBe(true);
      expect((outcome as { value: number }).value).toBeCloseTo(expected.value!, 9);
    }
  });

  it('a repeat item value is a rate: 0.5 is a valid boolean value only when reduced', () => {
    for (const c of scoreEdits.reduced as Array<{
      raw: string;
      score_type: string;
      reduced: boolean;
      expected: { value?: number; error?: string };
    }>) {
      const outcome = run(c.raw, c.score_type, c.reduced);
      if (c.expected.error !== undefined) expect(outcome).toEqual({ ok: false, message: c.expected.error });
      else expect(outcome).toEqual({ ok: true, value: c.expected.value });
    }
  });
});

describe('errors under the declared direction (C015 amended)', () => {
  it('a pass slice keeps a reviewer score on a failed task', () => {
    const row = {
      __pass_scope: true,
      status: 'error',
      metric_values: [0.2, ''],
      metric_meta: { h: { modified: 'true', original_score: 0 } },
    } as unknown as MetricRow;
    expect(getRowScore(row, 0, 'h', 'minimize')).toEqual({ score: expect.closeTo(0.2, 9), isError: false });
    expect(getRowScore(row, 1, 'q', 'maximize')).toEqual({ score: 0, isError: true });
    expect(rowMetricErrorCounts(row, 'h')).toEqual({ task: 0, scorer: 0 });
    expect(rowMetricErrorCounts(row, 'q')).toEqual({ task: 1, scorer: 0 });
    // Not a pass slice: a task error stays one for every metric.
    expect(getRowScore({ ...row, __pass_scope: false } as MetricRow, 0, 'h', 'minimize')).toEqual({
      score: null,
      isError: true,
    });
    // A reviewer's item value stands over the errored pass.
    const edited = {
      status: 'completed',
      metric_values: [0.9],
      metric_meta: { h: { item_edit: 'true', modified: 'true' } },
      pass_scores: { h: [0.2, 0] },
      pass_metric_meta: { h: [{}, { status: 'error' }] },
    } as unknown as MetricRow;
    expect(getRowScore(edited, 0, 'h', 'minimize')).toEqual({
      score: expect.closeTo(0.9, 9),
      isError: false,
    });
  });

  it('a scorer label "error" with its own metadata is a judged pass; a reviewed task failure keeps the score', () => {
    const rows = [
      {
        status: 'completed',
        metric_values: [0.3],
        pass_scores: { h: [0.2, 0.4] },
        pass_metric_meta: { h: [{ label: 'error', reason: 'judged' }, {}] },
        pass_attempts: [{ status: 'completed' }, { status: 'completed' }],
      },
      {
        status: 'completed',
        metric_values: [0.3],
        pass_scores: { h: [0.1, 0.5] },
        pass_metric_meta: { h: [{ label: 'error', modified: 'true', original_score: 0 }, {}] },
        pass_attempts: [{ status: 'error' }, { status: 'completed' }],
      },
    ] as unknown as MetricRow[];
    expect(rows.map((r) => getRowScore(r, 0, 'h', 'minimize'))).toEqual([
      { score: expect.closeTo(0.3, 9), isError: false },
      { score: expect.closeTo(0.3, 9), isError: false },
    ]);
  });

  it('the platform flags are never offered as metric fields', () => {
    expect(['task_error', 'modified', 'original_score', 'reason'].map(isInternalMetaKey)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

/**
 * Cutover of tests/platform/fixtures/metric_errors_contract.cjs (judge verdicts and execution
 * failures stay distinct) from the deleted vanilla metrics.js onto lib/metrics.ts.
 */

describe('judge verdicts and execution failures stay distinct', () => {
  it.each(['failed', 'error', 'timeout', 'FAILED'])('a label "%s" is a verdict, not an error', (label) => {
    const row = {
      status: 'completed',
      metric_values: [0, 1],
      metric_meta: { quality: { label } },
    } as unknown as MetricRow;
    expect(isMetricErrorMeta(row.metric_meta!.quality)).toBe(false);
    expect(hasMetricError(row, 'quality')).toBe(false);
    expect(isErrorRow(row)).toBe(false);
    expect(getRowScore(row, 0, 'quality')).toEqual({ score: 0, isError: false });
    row.pass_metric_meta = { quality: [{ label }, { label: 'passed' }] };
    expect(hasMetricError(row, 'quality')).toBe(false);
  });

  it('a verdict reason is a judged score, not a scorer crash (C010); only meta.status marks an execution error', () => {
    for (const meta of [
      { error: 'Empty output' },
      { is_valid: false, error: 'ERROR near "FROM": syntax error' },
      { reason: 'Empty output' },
      { status: 'success', error: 'ignored' },
    ]) {
      const row = {
        status: 'completed',
        metric_values: [0, 1],
        metric_meta: { valid_sql: meta },
      } as unknown as MetricRow;
      expect(isMetricErrorMeta(meta)).toBe(false);
      expect(hasMetricError(row, 'valid_sql')).toBe(false);
      expect(isErrorRow(row)).toBe(false);
      expect(getRowScore(row, 0, 'valid_sql')).toEqual({ score: 0, isError: false });
      row.pass_metric_meta = { valid_sql: [meta, {}] };
      expect(hasMetricError(row, 'valid_sql')).toBe(false);
    }
    expect(metricMetaDisplayKey('error', { error: 'Empty output' })).toBe('reason');
    expect(metricMetaDisplayKey('error', { status: 'error', error: 'boom' })).toBe('error');
    expect(metricMetaDisplayKey('error', { reason: 'r', error: 'e' })).toBe('error');
    expect(metricMetaDisplayKey('is_valid', { error: 'x' })).toBe('is_valid');
  });

  it.each([
    { status: 'error', error: '' },
    { status: 'failed' },
    { status: 'timeout' },
    { status: ' Timeout ' },
    { status: ' Error ', error: 'BusinessRuleError' },
  ])('a scorer exception %j marks its own metric only', (meta) => {
    const row = {
      status: 'completed',
      metric_values: [0, 1],
      metric_meta: { broken: meta, healthy: {} },
    } as unknown as MetricRow;
    expect(isTaskErrorRow(row)).toBe(false);
    expect(isErrorRow(row)).toBe(true);
    expect(getRowScore(row, 0, 'broken')).toEqual({ score: 0, isError: true });
    expect(getRowScore(row, 1, 'healthy')).toEqual({ score: 1, isError: false });
    // Without a metric name, a metric exception does not mark the score.
    expect(getRowScore(row, 0)).toEqual({ score: 0, isError: false });
    // A scorer exception on a pass keeps the item's value but flags it.
    row.metric_values = [0.5, 1];
    row.metric_meta = {};
    row.pass_metric_meta = { broken: [meta, {}] };
    expect(getRowScore(row, 0, 'broken')).toEqual({ score: 0.5, isError: true });
    expect(getRowScore(row, 1, 'healthy')).toEqual({ score: 1, isError: false });
  });

  it('a task error is an error for every metric', () => {
    expect(
      getRowScore({ status: 'error', metric_values: [1] } as unknown as MetricRow, 0, 'quality'),
    ).toEqual({ score: 0, isError: true });
    for (const status of ['error', 'FAILED']) {
      const row = { status, metric_values: [1], metric_meta: {} } as unknown as MetricRow;
      expect(isTaskErrorRow(row)).toBe(true);
      expect(isErrorRow(row)).toBe(true);
    }
  });
});
