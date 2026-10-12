import { describe, expect, it } from 'vitest';
import { tCritical, tTwoSidedP } from '../tdist';

// Reference values from scipy.stats.t (ppf(.975, df), 2 * sf(t, df)).
describe('student t', () => {
  it('critical values match scipy', () => {
    expect(tCritical(1)).toBeCloseTo(12.7062047, 5);
    expect(tCritical(3)).toBeCloseTo(3.1824463, 5);
    expect(tCritical(10)).toBeCloseTo(2.2281389, 5);
    expect(tCritical(30)).toBeCloseTo(2.0422725, 5);
    expect(tCritical(5000)).toBeCloseTo(1.9604, 3);
  });
  it('two-sided p-values match scipy', () => {
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 10);
    expect(tTwoSidedP(2.0, 10)).toBeCloseTo(0.0733880, 6);
    expect(tTwoSidedP(-1.5, 3)).toBeCloseTo(0.2306, 3);
  });
});
