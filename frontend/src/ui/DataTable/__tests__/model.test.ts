import { describe, expect, it } from 'vitest';
import {
  buildDisplayRows,
  groupBands,
  middleTruncate,
  nextSort,
  orderColumns,
  pinOffsets,
  rangeKeys,
  sortRows,
  suspendedPins,
} from '../model';
import type { Column } from '../types';

interface R {
  id: string;
  n: number | null;
  g: string;
}
const cols: Column<R>[] = [
  { id: 'id', header: 'Id', sort: 'id', pin: 'start', group: 'A' },
  { id: 'n', header: 'N', sort: 'n', type: 'number', group: 'A' },
  { id: 'x', header: 'X', pin: 'end' },
];

describe('nextSort', () => {
  it('cycles asc, desc, none', () => {
    const c = cols[1]!;
    const a = nextSort(null, c, true);
    expect(a).toEqual({ key: 'n', direction: 'asc' });
    const d = nextSort(a, c, true);
    expect(d).toEqual({ key: 'n', direction: 'desc' });
    expect(nextSort(d, c, true)).toBeNull();
    expect(nextSort(d, c, false)).toEqual({ key: 'n', direction: 'asc' });
  });
  it('honours first direction', () => {
    const c: Column<R> = { id: 'n', sort: { key: 'n', first: 'desc' } };
    expect(nextSort(null, c, true)).toEqual({ key: 'n', direction: 'desc' });
  });
});

describe('sortRows', () => {
  const rows: R[] = [
    { id: 'b', n: 2, g: 'x' },
    { id: 'a', n: null, g: 'x' },
    { id: 'c', n: 1, g: 'y' },
  ];
  it('sorts numbers with nulls last', () => {
    expect(sortRows(rows, cols, { key: 'n', direction: 'asc' }).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, cols, { key: 'n', direction: 'desc' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('returns input when unsorted', () => {
    expect(sortRows(rows, cols, null)).toBe(rows);
  });
});

describe('pins and bands', () => {
  it('orders pinned columns and computes cumulative offsets', () => {
    const ordered = orderColumns([cols[2]!, cols[1]!, cols[0]!], {});
    expect(ordered.map((c) => c.id)).toEqual(['id', 'n', 'x']);
    const off = pinOffsets(ordered, () => 100, {}, 40);
    expect(off).toEqual({ id: 40, x: 0 });
  });
  it('user pins override the declaration', () => {
    const ordered = orderColumns(cols, { id: null, n: 'start' });
    expect(ordered[0]!.id).toBe('n');
  });
  it('merges adjacent group bands', () => {
    expect(groupBands(cols).map((b) => [b.label, b.span])).toEqual([
      ['A', 2],
      [null, 1],
    ]);
  });
});

describe('display rows', () => {
  const rows: R[] = [
    { id: '1', n: 1, g: 'x' },
    { id: '2', n: 2, g: 'x' },
    { id: '3', n: 3, g: 'y' },
  ];
  it('inserts detail rows without shifting the logical index', () => {
    const d = buildDisplayRows(rows, (r) => r.id, {
      collapsed: new Set(),
      expanded: new Set(['1']),
      canExpand: true,
    });
    expect(d.map((x) => x.kind)).toEqual(['row', 'detail', 'row', 'row']);
    expect(d.filter((x) => x.kind === 'row').map((x) => (x.kind === 'row' ? x.index : -1))).toEqual([
      0, 1, 2,
    ]);
  });
  it('groups and collapses', () => {
    const d = buildDisplayRows(rows, (r) => r.id, {
      groupBy: { key: (r) => r.g, label: (k) => k, collapsible: true },
      collapsed: new Set(['x']),
      expanded: new Set(),
      canExpand: false,
    });
    expect(d.map((x) => x.kind)).toEqual(['group', 'group', 'row']);
  });
});

describe('helpers', () => {
  it('range selection is inclusive and order independent', () => {
    expect(rangeKeys(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c']);
  });
  it('middle truncates only long text', () => {
    expect(middleTruncate('short')).toBe('short');
    expect(middleTruncate('0123456789abcdefghijklmnop', 4)).toBe('0123…mnop');
  });
});

describe('column order', () => {
  const ids = (cs: Column<R>[]) => cs.map((c) => c.id);
  const many: Column<R>[] = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
    { id: 'act', pin: 'end', lockOrder: true },
  ];

  it('keeps the declared order when nothing is saved', () => {
    expect(ids(orderColumns(many, {}, null))).toEqual(['a', 'b', 'c', 'd', 'act']);
  });

  it('applies a saved order; unsaved columns follow their nearest declared predecessor, locked ones stay', () => {
    expect(ids(orderColumns(many, {}, ['c', 'a', 'b']))).toEqual(['c', 'd', 'a', 'b', 'act']);
    // a new column after "b" lands after the nearest preceding declared column
    const grown: Column<R>[] = [...many.slice(0, 2), { id: 'new' }, ...many.slice(2)];
    expect(ids(orderColumns(grown, {}, ['c', 'a', 'b']))).toEqual(['c', 'd', 'a', 'b', 'new', 'act']);
  });

  it('drops unknown ids from a saved order', () => {
    expect(ids(orderColumns(many, {}, ['gone', 'd', 'a']))).toEqual(['d', 'a', 'b', 'c', 'act']);
  });

  it('pins partition stably: pinning does not reshuffle the saved order inside a block', () => {
    const order = ['d', 'c', 'b', 'a'];
    expect(ids(orderColumns(many, { b: 'start', a: 'start' }, order))).toEqual(['b', 'a', 'd', 'c', 'act']);
    expect(ids(orderColumns(many, { c: 'start' }, order))).toEqual(['c', 'd', 'b', 'a', 'act']);
  });
});

describe('suspendedPins', () => {
  const w = (id: string) => ({ run: 260, status: 200, date: 130 })[id] ?? 100;
  it('keeps the first frozen column and suspends the ones past the cap', () => {
    expect(suspendedPins(['run', 'status', 'date'], w, 1000, 0.5)).toEqual(['date']);
    expect(suspendedPins(['run', 'status', 'date'], w, 1400, 0.5)).toEqual([]);
    expect(suspendedPins(['run', 'status'], w, 300, 0.5)).toEqual(['status']);
  });
  it('never suspends the only frozen column and ignores unmeasured scrollers', () => {
    expect(suspendedPins(['run'], w, 100, 0.5)).toEqual([]);
    expect(suspendedPins(['run', 'status'], w, 0, 0.5)).toEqual([]);
  });
});
