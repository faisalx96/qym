import { describe, expect, it } from 'vitest';
import { trendDomain, trendFormat, trendFormatDelta, trendIsRate } from '../trendModel';

describe('trend model', () => {
  it('treats 0..1 means as a rate and anything else as a plain number', () => {
    expect(trendIsRate([0.2, 0.9, null])).toBe(true);
    expect(trendIsRate([0.2, 4.5])).toBe(false);
    expect(trendIsRate([])).toBe(true);
  });
  it('formats rates as percentages and numbers by magnitude', () => {
    expect(trendFormat(0.8123, true)).toBe('81.2%');
    expect(trendFormat(4.5, false)).toBe('4.500');
    expect(trendFormat(45.25, false)).toBe('45.3');
    expect(trendFormat(1234.4, false)).toBe('1234');
    expect(trendFormat(null, true)).toBe('—');
  });
  it('formats deltas with a sign and pts for rates', () => {
    expect(trendFormatDelta(0.032, true)).toBe('+3.2 pts');
    expect(trendFormatDelta(-0.5, false)).toBe('−0.500');
    expect(trendFormatDelta(null, true)).toBe('');
  });
  it('fits the domain: rates snap to 5% steps inside 0..1, numbers pad', () => {
    expect(trendDomain([0.8, 0.9], true)).toEqual([0.75, 0.95]);
    expect(trendDomain([null], true)).toEqual([0, 1]);
    const [lo, hi] = trendDomain([2, 4], false);
    expect(lo).toBeLessThan(2);
    expect(hi).toBeGreaterThan(4);
  });
});
