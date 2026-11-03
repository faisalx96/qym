import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_WIDTH, headerMinWidth } from '../model';
import type { Column } from '../types';

type Row = { n: number };
const col = (c: Partial<Column<Row>>): Column<Row> => ({ id: 'c', header: 'x', cell: (r) => r.n, ...c }) as Column<Row>;

describe('headerMinWidth (round 10, D10-8)', () => {
  it('measures the drawn header string, not the accessible label', () => {
    // "#" labelled "Run number": 1 char, not 10 (102 px before)
    expect(headerMinWidth(col({ header: '#', label: 'Run number' }), false)).toBe(Math.ceil(8.6) + 16);
    expect(headerMinWidth(col({ header: '#', label: 'Run number' }), false)).toBeLessThan(48);
  });

  it('is unchanged for a header without a label', () => {
    expect(headerMinWidth(col({ header: 'Priority' }), false)).toBe(Math.ceil(8 * 8.6) + 16);
    expect(headerMinWidth(col({ header: 'Priority' }), true)).toBe(Math.ceil(8 * 8.6) + 32);
  });

  it('falls back to the default for a node header or a hidden label', () => {
    expect(headerMinWidth(col({ header: undefined as unknown as string, label: 'Long accessible name' }), false)).toBe(
      DEFAULT_MIN_WIDTH,
    );
    expect(headerMinWidth(col({ header: 'Name', hideLabel: true }), false)).toBe(DEFAULT_MIN_WIDTH);
  });

  it('counts a number header by its digits', () => {
    expect(headerMinWidth(col({ header: 12 as unknown as string }), false)).toBe(Math.ceil(2 * 8.6) + 16);
  });
});
