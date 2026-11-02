import { describe, expect, it } from 'vitest';
import { changeMagnitude } from '../filters';

describe('changeMagnitude (sort: biggest change vs baseline)', () => {
  it('sums the absolute differences of the other runs from the baseline', () => {
    expect(changeMagnitude([0.5, 0.8, 0.2], [0])).toBeCloseTo(0.6);
  });
  it('ignores missing scores and returns 0 without a baseline score', () => {
    expect(changeMagnitude([null, 0.8], [0])).toBe(0);
    expect(changeMagnitude([0.5, null, 0.7], [0])).toBeCloseTo(0.2);
  });
  it('averages several baseline runs (a repeat run)', () => {
    expect(changeMagnitude([0.4, 0.6, 1], [0, 1])).toBeCloseTo(0.5);
  });
});
