/**
 * Cutover of tests/platform/test_run_means.py (client halves): the run page's means come from the
 * rows the server sends, through lib/metrics.ts. The rows are golden files that the pytest side
 * (tests/platform/test_run_means.py) proves the server still produces.
 */
import { describe, expect, it } from 'vitest';
import classic from '../../../../tests/platform/fixtures/golden/run_means_classic.json';
import edited from '../../../../tests/platform/fixtures/golden/run_means_edited_score.json';
import repeat from '../../../../tests/platform/fixtures/golden/run_means_repeat_errors.json';
import { getRowScore, scoreWithoutMetricErrors, type MetricRow } from '../metrics';

const rowsOf = (golden: { rows: unknown }) => golden.rows as MetricRow[];

describe('run page means (C015): task and scorer errors count as 0', () => {
  it('averages the server rows to the same mean as the runs list', () => {
    const rows = rowsOf(classic);
    for (const [idx, name] of classic.metrics.entries()) {
      let sum = 0;
      let count = 0;
      for (const row of rows) {
        const { score } = getRowScore(row, idx, name);
        if (score !== null) {
          sum += score;
          count++;
        }
      }
      expect(sum / count, name).toBeCloseTo((classic.expected as Record<string, number>)[name]!, 9);
    }
  });

  it('reads a score edited over a scorer error as a clean value', () => {
    const scores = rowsOf(edited).map((row) => getRowScore(row, 0, edited.metric));
    expect(scores.map((s) => s.isError)).toEqual([false, false, false]);
    expect(scores.map((s) => s.score)).toEqual([1.0, 0.45, 0.5]);
  });

  it('leaves the errored passes out of "mean without errors" and counts them', () => {
    let sum = 0;
    let count = 0;
    let errors = 0;
    for (const row of rowsOf(repeat)) {
      const clean = scoreWithoutMetricErrors(row, 0, repeat.metric);
      errors += clean.errors;
      if (clean.score !== null) {
        sum += clean.score;
        count++;
      }
    }
    expect(sum / count).toBeCloseTo(0.8, 9);
    expect(errors).toBe(3);
  });
});
