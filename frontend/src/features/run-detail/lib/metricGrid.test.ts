/** RD12: the Overview metric grid fills every row with the fewest, most even rows. */
import { describe, expect, it } from 'vitest';
import { balancedRows, metricGridLayout, metricGridStyles } from './metricGrid';

describe('balancedRows', () => {
  it('splits 1 to 9 cards in rows of at most 3 (1600px with the sidebar) into the most even rows', () => {
    const split = Array.from({ length: 9 }, (_, i) => balancedRows(i + 1, 3).join('+'));
    expect(split).toEqual(['1', '2', '3', '2+2', '3+2', '3+3', '3+2+2', '3+3+2', '3+3+3']);
  });

  it('puts the fuller rows first and never leaves a lone card when a balanced split exists', () => {
    expect(balancedRows(7, 4)).toEqual([4, 3]);
    expect(balancedRows(5, 4)).toEqual([3, 2]);
    expect(balancedRows(4, 4)).toEqual([4]);
    expect(balancedRows(5, 2)).toEqual([2, 2, 1]);
    expect(balancedRows(3, 1)).toEqual([1, 1, 1]);
    expect(balancedRows(0, 3)).toEqual([]);
  });
});

describe('metricGridLayout', () => {
  it('gives each row the full width: the spans of every row add up to the track count', () => {
    for (let count = 1; count <= 12; count += 1) {
      const { tracks, spans } = metricGridLayout(count);
      tracks.forEach((t, c) => {
        let i = 0;
        for (const size of balancedRows(count, c + 1)) {
          const row = spans.slice(i, i + size).map((s) => s[c]!);
          expect(row.reduce((a, b) => a + b, 0)).toBe(t);
          expect(new Set(row).size).toBe(1);
          i += size;
        }
      });
    }
  });

  it('uses the least common multiple of the row sizes as the track count (5 in rows of 3: 6 tracks, spans 2 and 3)', () => {
    const { tracks, spans } = metricGridLayout(5);
    expect(tracks).toEqual([1, 2, 6, 6, 5, 5]);
    expect(spans.map((s) => s[2])).toEqual([2, 2, 2, 3, 3]);
    expect(spans.map((s) => s[1])).toEqual([1, 1, 1, 1, 2]);
  });
});

describe('metricGridStyles', () => {
  it('names one custom property per column count on the grid and on each card', () => {
    const { grid, items } = metricGridStyles(2);
    expect(grid).toMatchObject({ '--mg-tracks-1': 1, '--mg-tracks-3': 2, '--mg-tracks-6': 2 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ '--mg-span-1': 1, '--mg-span-3': 1 });
  });
});
