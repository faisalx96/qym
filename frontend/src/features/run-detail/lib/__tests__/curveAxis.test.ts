import { describe, expect, it } from 'vitest';
import { curveAxis, niceStep, percentTick } from '../curveAxis';

describe('curve y axis (cv4 C1-7)', () => {
  it('keeps 0 to 100% in fifths when the curves span most of it', () => {
    const axis = curveAxis([0.52, 0.77, 0.89, 1, 0.27, 0.14, 0]);
    expect(axis.domain).toEqual([0, 1]);
    expect(axis.ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('zooms in on a narrow band with a margin above and below, on clean ticks', () => {
    const axis = curveAxis([0.72, 0.74, 0.75, 0.78]);
    const [lo, hi] = axis.domain;
    expect(lo).toBeLessThan(0.72);
    expect(hi).toBeGreaterThan(0.78);
    expect(lo).toBeGreaterThanOrEqual(0.6);
    expect(hi).toBeLessThanOrEqual(0.9);
    expect(axis.ticks[0]).toBe(lo);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(hi);
    const step = axis.ticks[1]! - axis.ticks[0]!;
    expect([0.01, 0.02, 0.05]).toContainEqual(Math.round(step * 1e9) / 1e9);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(3);
    expect(axis.ticks.length).toBeLessThanOrEqual(6);
  });

  it('counts the confidence band in the range', () => {
    const tight = curveAxis([0.7, 0.71]);
    const wide = curveAxis([0.7, 0.71, 0.62, 0.79]);
    expect(wide.domain[0]).toBeLessThanOrEqual(0.62);
    expect(wide.domain[1]).toBeGreaterThanOrEqual(0.79);
    expect(wide.domain[1] - wide.domain[0]).toBeGreaterThan(tight.domain[1] - tight.domain[0]);
  });

  it('clamps to 0 and 100%', () => {
    const top = curveAxis([0.97, 0.99, 1]);
    expect(top.domain[1]).toBe(1);
    expect(top.domain[0]).toBeLessThan(0.97);
    const bottom = curveAxis([0, 0.01, 0.03]);
    expect(bottom.domain[0]).toBe(0);
    expect(bottom.domain[1]).toBeGreaterThan(0.03);
  });

  it('does not blow one flat value up to fill the plot', () => {
    const axis = curveAxis([0.715, 0.715, 0.715]);
    expect(axis.domain[1] - axis.domain[0]).toBeGreaterThanOrEqual(0.02);
    expect(axis.domain[0]).toBeLessThan(0.715);
    expect(axis.domain[1]).toBeGreaterThan(0.715);
  });

  it('falls back to 0 to 100% with no values', () => {
    expect(curveAxis([]).domain).toEqual([0, 1]);
  });

  it('fits a raw numeric average without a range', () => {
    const axis = curveAxis([12.4, 13.1, 12.9], { range: null, minSpan: 1 });
    expect(axis.domain[0]).toBeLessThan(12.4);
    expect(axis.domain[1]).toBeGreaterThan(13.1);
  });

  it('fullAt: the pass box plots still zoom on a spread from 37 to 100% (cv4 Y7)', () => {
    expect(curveAxis([0.37, 1]).domain).toEqual([0, 1]);
    const axis = curveAxis([0.37, 1], { fullAt: 0.9 });
    expect(axis.domain[0]).toBeGreaterThan(0);
    expect(axis.domain[0]).toBeLessThan(0.37);
    expect(axis.domain[1]).toBe(1);
  });

  it('picks clean steps and labels them', () => {
    expect(niceStep(0.6, 0.8)).toBe(0.05);
    expect(niceStep(0, 1)).toBe(0.2);
    expect(percentTick(0.75, [0.7, 0.75, 0.8])).toBe('75%');
    expect(percentTick(0.715, [0.71, 0.715, 0.72])).toBe('71.5%');
  });
});
