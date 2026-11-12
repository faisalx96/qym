/** cv4 Y13: every pass that ties on the shown (rounded) value is marked best or worst. */
import { describe, expect, it } from 'vitest';
import { passExtremes } from '../PassTable';

const passes = [0.7301, 0.7298, 0.7104, 0.6812, 0.6809].map((v, i) => ({
  pass_number: i + 1,
  metric_means: { m: v },
}));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

describe('passExtremes (cv4 Y13)', () => {
  it('marks every tie on the shown value', () => {
    expect(passExtremes(passes, 'm', 'maximize', pct)).toEqual({ best: [1, 2], worst: [4, 5] });
    expect(passExtremes(passes, 'm', 'minimize', pct)).toEqual({ best: [4, 5], worst: [1, 2] });
  });

  it('marks nothing without a direction or when every shown value is the same', () => {
    expect(passExtremes(passes, 'm', null, pct)).toEqual({ best: [], worst: [] });
    expect(passExtremes(passes.slice(0, 2), 'm', 'maximize', pct)).toEqual({ best: [], worst: [] });
  });
});
