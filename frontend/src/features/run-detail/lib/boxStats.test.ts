/** Round 3 P7: box statistics (P7-2 inputs, P7-4 quantiles, P7-10 decimation, P7-11 small n). */
import { describe, expect, it } from 'vitest';
import { boxStats, decimate, hasNegative } from './boxStats';
import { boxAxis, niceStepFor } from './boxAxis';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('boxStats', () => {
  it('uses linear interpolation (type 7): 1..100 gives 25.75, 50.5, 75.25, 5.95, 95.05 (P7-4)', () => {
    const s = boxStats(range(100));
    expect(s.p25).toBeCloseTo(25.75);
    expect(s.median).toBeCloseTo(50.5);
    expect(s.p75).toBeCloseTo(75.25);
    expect(s.p5).toBeCloseTo(5.95);
    expect(s.p95).toBeCloseTo(95.05);
    expect(s.mean).toBeCloseTo(50.5);
    expect(s.sum).toBe(5050);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
  });

  it('low and high are the values strictly outside [p5, p95]', () => {
    const s = boxStats(range(100));
    expect(s.low).toEqual([1, 2, 3, 4, 5]);
    expect(s.high).toEqual([96, 97, 98, 99, 100]);
    expect(s.lowCount).toBe(5);
  });

  it('caps each side at 40 dots and always keeps the true min and max (P7-10)', () => {
    const values = [
      ...Array.from({ length: 5000 }, (_, i) => 100 + (i % 50)),
      ...range(300).map((i) => -i),
      ...range(300).map((i) => 1000 + i),
    ];
    const s = boxStats(values);
    expect(s.low.length).toBeLessThanOrEqual(40);
    expect(s.high.length).toBeLessThanOrEqual(40);
    expect(s.low[0]).toBe(-300);
    expect(s.high[s.high.length - 1]).toBe(1300);
    expect(s.highCount).toBeGreaterThan(40);
  });

  it('decimate keeps first and last and is a no-op under the limit', () => {
    expect(decimate([1, 2, 3], 40)).toEqual([1, 2, 3]);
    const d = decimate(range(1000), 40);
    expect(d).toHaveLength(40);
    expect(d[0]).toBe(1);
    expect(d[39]).toBe(1000);
  });

  it('with fewer than 20 values whiskers are min and max and there are no dots (P7-11)', () => {
    const s = boxStats([1, 2, 3, 4, 100]);
    expect(s.percentiles).toBe(false);
    expect([s.p5, s.p95]).toEqual([1, 100]);
    expect(s.low).toEqual([]);
    expect(s.high).toEqual([]);
  });

  it('handles none, one and equal values', () => {
    expect(boxStats([]).n).toBe(0);
    const one = boxStats([7]);
    expect([one.n, one.min, one.median, one.mean, one.max]).toEqual([1, 7, 7, 7, 7]);
    const same = boxStats(Array(30).fill(4));
    expect([same.min, same.max, same.p25, same.p75]).toEqual([4, 4, 4, 4]);
  });

  it('ignores non-finite values', () => {
    expect(boxStats([1, NaN, Infinity, 3]).n).toBe(2);
  });

  it('hasNegative gates the Total row', () => {
    expect(hasNegative([1, -1])).toBe(true);
    expect(hasNegative([0, 3])).toBe(false);
  });
});

describe('boxAxis', () => {
  it('starts at 0 for non-negative data and uses nice ticks, at most 5', () => {
    const a = boxAxis(boxStats(range(100)));
    expect(a.domain[0]).toBe(0);
    expect(a.ticks.length).toBeLessThanOrEqual(5);
    expect(a.domain[1]).toBeGreaterThanOrEqual(100);
    expect(a.clipped).toBe(false);
  });

  it('clips at 1.15 x p95 when the max is more than 4 x p95', () => {
    const values = [...range(99), 100000];
    const s = boxStats(values);
    const a = boxAxis(s);
    expect(a.clipped).toBe(true);
    expect(a.domain[1]).toBeLessThan(200);
  });

  it('niceStepFor picks 1, 2, 2.5, 5 times a power of ten', () => {
    expect(niceStepFor(100, 5)).toBe(25);
    expect(niceStepFor(8, 5)).toBe(2);
  });
});
