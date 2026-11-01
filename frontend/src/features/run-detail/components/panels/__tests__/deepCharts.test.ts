/** C221 and C167: the relationship scatter fits its axes; the correlation matrix is a heatmap of |r| with the sign in the number. */
import { describe, expect, it } from 'vitest';
import { fittedDomain } from '../../charts/Charts';
import { correlationTone, signedR } from '../DeepTab';

describe('fitted scatter axes (C221)', () => {
  it('span the data with 5% padding on each side, not 0 to 1', () => {
    const [lo, hi] = fittedDomain([0.55, 0.6, 0.83]);
    expect(lo).toBeCloseTo(0.55 - 0.014, 6);
    expect(hi).toBeCloseTo(0.83 + 0.014, 6);
  });

  it('keep a threshold line inside, and give a single value some room', () => {
    const [lo, hi] = fittedDomain([0.6, 0.7], 0.8);
    expect(lo).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0.8);
    const [a, b] = fittedDomain([0.5, 0.5]);
    expect(a).toBeLessThan(0.5);
    expect(b).toBeGreaterThan(0.5);
    expect(fittedDomain([])).toEqual([0, 1]);
  });
});

describe('correlation heatmap (C167)', () => {
  it('one --chart-1 ramp by |r| on a fixed 0 to 1 scale: the sign does not change the colour', () => {
    expect(correlationTone(0.6)).toBe(correlationTone(-0.6));
    expect(correlationTone(0.2)).toContain('var(--chart-1)');
    expect(correlationTone(0.2)).not.toMatch(/accent/);
    expect(correlationTone(0)).not.toBe(correlationTone(1));
    expect(correlationTone(null)).toBeUndefined();
  });

  it('carries the sign in the number', () => {
    expect(signedR(0.2)).toBe('+0.20');
    expect(signedR(-0.15)).toBe('−0.15');
    expect(signedR(0.001)).toBe('0.00');
  });
});
