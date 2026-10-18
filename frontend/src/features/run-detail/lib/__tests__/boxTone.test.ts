/** Round 5 R2: the tone of a box plot. */
import { describe, expect, it } from 'vitest';
import { boxTone } from '../boxTone';

describe('boxTone', () => {
  it('takes the band of the median for a directed score', () => {
    expect(boxTone(0.71, 'percentage', 'maximize')).toEqual({ band: 3 });
    expect(boxTone(0.45, 'percentage', 'maximize')).toEqual({ band: 2 });
  });

  it('inverts for a lower-is-better score', () => {
    expect(boxTone(0.05, 'percentage', 'minimize').band).toBe(5);
  });

  it('falls back to series 1 without a direction, for a numeric type or without a median', () => {
    expect(boxTone(0.7, 'percentage', null)).toEqual({ series: 1 });
    expect(boxTone(700, 'numeric', 'maximize')).toEqual({ series: 1 });
    expect(boxTone(null, 'percentage', 'maximize')).toEqual({ series: 1 });
  });
});
