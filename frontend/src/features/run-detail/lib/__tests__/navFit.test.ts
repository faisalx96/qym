/** RF1 (C132): the run nav links that stay in the row, and the ones that go into More. */
import { describe, expect, it } from 'vitest';
import { fitNavLinks } from '../navFit';

const widths = [80, 60, 70, 100, 90, 85, 95, 85];
const opts = { gap: 4, more: 70, active: -1 };

describe('fitNavLinks', () => {
  it('keeps every link when they all fit', () => {
    expect(fitNavLinks(widths, { ...opts, available: 800 })).toEqual(widths.map(() => true));
  });

  it('keeps the links that fit in page order and leaves room for More', () => {
    // 80+60+70+100+90 + 4 gaps = 416; More (70) and its gap need 74 more
    expect(fitNavLinks(widths, { ...opts, available: 490 })).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('keeps the active link in the row in place of the last links that fit', () => {
    const shown = fitNavLinks(widths, { ...opts, available: 490, active: 7 });
    expect(shown[7]).toBe(true);
    expect(shown.slice(0, 4)).toEqual([true, true, true, true]);
    expect(shown[4]).toBe(false);
  });

  it('an active link that already fits changes nothing', () => {
    expect(fitNavLinks(widths, { ...opts, available: 490, active: 1 })).toEqual(
      fitNavLinks(widths, { ...opts, available: 490 }),
    );
  });
});
