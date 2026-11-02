/** Round 3 P4: the header never overlaps an expanded detail; pure geometry of the sticky shift. */
import { describe, expect, it } from 'vitest';
import { computeShift, isSuspended } from '../stickyShift';

const base = { tableTop: 100, tableH: 3000, headH: 58 };

describe('computeShift', () => {
  it('without details it is the plain clamp (unchanged behaviour)', () => {
    expect(computeShift({ ...base, line: 50, details: [] })).toBe(0);
    expect(computeShift({ ...base, line: 400, details: [] })).toBe(300);
    expect(computeShift({ ...base, line: 9000, details: [] })).toBe(3000 - 58);
  });

  it('before the detail the header sticks at the line', () => {
    const details = [{ top: 1100, bottom: 4100 }];
    expect(computeShift({ ...base, line: 400, details })).toBe(300);
  });

  it('it stops when its bottom touches the detail top', () => {
    const details = [{ top: 600, bottom: 3600 }];
    // header would sit at tableTop + 600 = 700 > 600 - 58: capped at 600 - 100 - 58
    expect(computeShift({ ...base, line: 700, details })).toBe(442);
    expect(computeShift({ ...base, line: 600, details })).toBe(442);
  });

  it('inside the detail it stays held above it, so it never overlaps (area 0)', () => {
    const details = [{ top: 600, bottom: 3600 }];
    for (let line = 600; line < 3600; line += 100) {
      const shift = computeShift({ ...base, line, details });
      const headBottom = base.tableTop + shift + base.headH;
      expect(headBottom).toBeLessThanOrEqual(600);
      expect(isSuspended({ ...base, line, details })).toBe(true);
    }
  });

  it('after the detail the header returns to the line at once', () => {
    const details = [{ top: 600, bottom: 3600 }];
    expect(computeShift({ ...base, line: 3600, details: [] })).toBe(3000 - 58);
    expect(computeShift({ ...base, line: 3600, details })).toBe(2942);
    expect(isSuspended({ ...base, line: 3700, details })).toBe(false);
  });

  it('with two details the rule applies to each and the header sticks between them', () => {
    const details = [
      { top: 600, bottom: 1400 },
      { top: 1800, bottom: 2600 },
    ];
    expect(computeShift({ ...base, line: 1000, details })).toBe(442);
    expect(computeShift({ ...base, line: 1500, details })).toBe(1400);
    expect(computeShift({ ...base, line: 2000, details })).toBe(1800 - 100 - 58);
    expect(computeShift({ ...base, line: 2700, details })).toBe(2600);
  });

  it('a detail above the line (already passed) does not cap anything', () => {
    expect(computeShift({ ...base, line: 900, details: [{ top: 300, bottom: 800 }] })).toBe(800);
  });
});
