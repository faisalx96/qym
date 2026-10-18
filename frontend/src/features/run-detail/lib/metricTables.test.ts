/** Round 5 R3: which metric detail values render as a table. */
import { describe, expect, it } from 'vitest';
import { TABLE_ROW_CAP, detectTable } from './metricTables';

describe('detectTable', () => {
  it('reads {columns, rows} with array rows', () => {
    const t = detectTable({
      columns: ['a', 'b'],
      rows: [
        [1, 'x'],
        [2, 'y'],
      ],
    });
    expect(t?.columns).toEqual(['a', 'b']);
    expect(t?.rows).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
  });

  it('reads {columns, rows} with object rows and pads missing cells with null', () => {
    const t = detectTable({ columns: ['a', 'b'], rows: [{ a: 1 }, { a: 2, b: 3 }] });
    expect(t?.rows).toEqual([
      { a: 1, b: null },
      { a: 2, b: 3 },
    ]);
  });

  it('reads an array of arrays with generated column names', () => {
    const t = detectTable([[1, 2], [3, 4], [5]]);
    expect(t?.columns).toEqual(['Column 1', 'Column 2']);
    expect(t?.rows[2]).toEqual({ 'Column 1': 5, 'Column 2': null });
  });

  it('reads an array of 2 or more uniform plain objects', () => {
    const t = detectTable([
      { criterion: 'a', weight: 0.3 },
      { criterion: 'b', weight: 0.7 },
    ]);
    expect(t?.columns).toEqual(['criterion', 'weight']);
    expect(t?.total).toBe(2);
  });

  it('accepts key sets that overlap by 80% or more and rejects less', () => {
    const base = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    expect(detectTable([base, { a: 1, b: 2, c: 3, d: 4 }])).not.toBeNull();
    expect(detectTable([base, { a: 1, b: 2, c: 3 }])).toBeNull();
  });

  it('keeps a single object, a list of scalars, mixed arrays and nested values as trees', () => {
    expect(detectTable([{ a: 1 }])).toBeNull();
    expect(detectTable(['x', 'y'])).toBeNull();
    expect(detectTable([{ a: 1 }, 'x'])).toBeNull();
    expect(detectTable([{ a: { n: 1 } }, { a: { n: 2 } }])).toBeNull();
    expect(detectTable({ retrieval: { precision: 0.8 }, generation: { fluency: 0.9 } })).toBeNull();
    expect(detectTable({ columns: ['a'], rows: [[1]], extra: 1 })).toBeNull();
    expect(detectTable('text')).toBeNull();
    expect(detectTable(null)).toBeNull();
  });

  it('caps the rows at 200 and reports the total', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ i, v: i * 2 }));
    const t = detectTable(rows)!;
    expect(t.rows).toHaveLength(TABLE_ROW_CAP);
    expect(t.total).toBe(250);
  });
});
