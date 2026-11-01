/** K3 (C029): an item chip shows its signed change against the baseline. */
import { describe, expect, it } from 'vitest';
import { chipDelta } from '../baseline';

describe('chipDelta', () => {
  it('writes a score change in points with its glyph', () => {
    expect(chipDelta(0.084, 'score')).toBe('▲ +8.4');
    expect(chipDelta(-0.15, 'percentage')).toBe('▼ −15.0');
    expect(chipDelta(0, 'score')).toBe('≈ 0.0');
  });

  it('writes a numeric change in its unit and a boolean change as the glyph only', () => {
    expect(chipDelta(-0.12, 'numeric')).toBe('▼ −0.120');
    expect(chipDelta(3, 'numeric')).toBe('▲ +3');
    expect(chipDelta(1, 'boolean')).toBe('▲');
    expect(chipDelta(0, 'boolean')).toBe('≈');
  });
});
