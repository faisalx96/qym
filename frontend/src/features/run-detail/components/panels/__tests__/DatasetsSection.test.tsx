/** Multi-dataset round, QC-U14 to QC-U17: the delta text of the breakdown (U+2212, one decimal, no sign colour). */
import { describe, expect, it } from 'vitest';
import { deltaText } from '../DatasetsSection';

describe('deltaText', () => {
  it('writes percentage points for percent metrics with the typographic minus', () => {
    expect(deltaText(0.661, 0.689, true)).toBe('−2.8');
    expect(deltaText(0.708, 0.689, true)).toBe('+1.9');
    expect(deltaText(0.719, 0.689, true)).toBe('+3.0');
  });

  it('is 0.0 below a twentieth of a point and the raw difference for other metrics', () => {
    expect(deltaText(0.6891, 0.689, true)).toBe('0.0');
    expect(deltaText(12.5, 10, false)).toBe('+2.5');
    expect(deltaText(7, 10, false)).toBe('−3.0');
  });

  it('is empty when either side has no score', () => {
    expect(deltaText(null, 0.5, true)).toBe('');
    expect(deltaText(0.5, null, true)).toBe('');
  });
});
