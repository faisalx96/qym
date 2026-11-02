/** Round 3 P5: matrix row order, the 8-row limit, the mean and the "differs" summary. */
import { describe, expect, it } from 'vitest';
import { differsAcrossPasses, limitRows, matrixSummary, meanOf, orderMetrics } from './metricMatrix';

describe('metricMatrix', () => {
  it('puts the analysis metric first and keeps run order for the rest', () => {
    expect(orderMetrics(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(orderMetrics(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(orderMetrics(['a', 'b'], 'zzz')).toEqual(['a', 'b']);
  });

  it('shows 8 rows until expanded', () => {
    const rows = Array.from({ length: 24 }, (_, i) => i);
    expect(limitRows(rows, false)).toHaveLength(8);
    expect(limitRows(rows, true)).toHaveLength(24);
  });

  it('means skip missing values', () => {
    expect(meanOf([1, 0, null, 1])).toBeCloseTo(2 / 3);
    expect(meanOf([null])).toBeNull();
  });

  it('detects a metric that differs across passes', () => {
    expect(differsAcrossPasses([1, 1, 1])).toBe(false);
    expect(differsAcrossPasses([1, 0, 1])).toBe(true);
    expect(differsAcrossPasses([1, null])).toBe(false);
  });

  it('writes the summary line', () => {
    expect(matrixSummary({ shown: 8, total: 24, passes: 1, belowThreshold: 3, differing: 0 })).toBe(
      '8 shown of 24 · 3 below threshold',
    );
    expect(matrixSummary({ shown: 8, total: 24, passes: 10, belowThreshold: 0, differing: 1 })).toBe(
      '8 shown of 24 · 1 metric differs across passes',
    );
    expect(matrixSummary({ shown: 8, total: 24, passes: 10, belowThreshold: 0, differing: 5 })).toContain(
      '5 metrics differ',
    );
  });
});
