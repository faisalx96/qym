/** Pure DataTable logic (sort, order, pins, grouping, range selection, persisted state). Unit-tested. */
import { KEYS, readJson } from '@/lib/storage';
import type { CellType, Column, Density, DisplayRow, GroupByConfig, Key, SortState } from './types';

export const NUMERIC_TYPES: ReadonlySet<CellType> = new Set(['number', 'delta', 'duration']);
export const MONO_TYPES: ReadonlySet<CellType> = new Set(['id', 'number', 'score', 'delta', 'duration']);
export const DEFAULT_MIN_WIDTH = 44;
export const FLEX_MIN_WIDTH = 120;
export const SELECT_COL_WIDTH = 40;

export function sortKeyOf<R>(col: Column<R>): string | undefined {
  if (typeof col.sort === 'string') return col.sort;
  return col.sort?.key;
}

export function alignOf<R>(col: Column<R>): 'start' | 'end' {
  if (col.align) return col.align;
  return col.type && NUMERIC_TYPES.has(col.type) ? 'end' : 'start';
}

export function isMono<R>(col: Column<R>): boolean {
  return col.mono ?? (col.type ? MONO_TYPES.has(col.type) : false);
}

export function headerOf<R>(col: Column<R>) {
  return col.header;
}

export function headerText<R>(col: Column<R>): string {
  const h = headerOf(col);
  return typeof h === 'string' || typeof h === 'number' ? String(h) : col.id;
}

/** Click cycle: first direction, the opposite one, then (optionally) unsorted. */
export function nextSort<R>(
  current: SortState | null | undefined,
  col: Column<R>,
  allowUnsorted: boolean,
): SortState | null {
  const key = sortKeyOf(col);
  if (!key) return current ?? null;
  const first = typeof col.sort === 'object' ? (col.sort.first ?? 'asc') : 'asc';
  const second = first === 'asc' ? 'desc' : 'asc';
  if (!current || current.key !== key) return { key, direction: first };
  if (current.direction === first) return { key, direction: second };
  return allowUnsorted ? null : { key, direction: first };
}

export function sortRows<R>(rows: R[], columns: Column<R>[], sort: SortState | null): R[] {
  if (!sort) return rows;
  const col = columns.find((c) => sortKeyOf(c) === sort.key || c.id === sort.key);
  if (!col) return rows;
  const custom = typeof col.sort === 'object' ? col.sort.compare : undefined;
  const value = (r: R): unknown => (col.accessor ? col.accessor(r) : (r as Record<string, unknown>)[col.id]);
  const cmp =
    custom ??
    ((a: R, b: R) => {
      const x = value(a);
      const y = value(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    });
  const dir = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => cmp(a.r, b.r) * dir || a.i - b.i)
    .map((x) => x.r);
}

/** Pinned-start columns first, pinned-end last, the rest keep their order. */
export function orderColumns<R>(
  cols: Column<R>[],
  pins: Record<string, 'start' | 'end' | null>,
): Column<R>[] {
  const pinOf = (c: Column<R>) => (c.id in pins ? pins[c.id] : (c.pin ?? null));
  return [
    ...cols.filter((c) => pinOf(c) === 'start'),
    ...cols.filter((c) => !pinOf(c)),
    ...cols.filter((c) => pinOf(c) === 'end'),
  ];
}

export function effectivePin<R>(
  col: Column<R>,
  pins: Record<string, 'start' | 'end' | null>,
): 'start' | 'end' | null {
  return col.id in pins ? pins[col.id]! : (col.pin ?? null);
}

/** Cumulative sticky offsets from measured/declared widths. */
export function pinOffsets<R>(
  ordered: Column<R>[],
  widthOf: (id: string) => number,
  pins: Record<string, 'start' | 'end' | null>,
  leading = 0,
): Record<string, number> {
  const out: Record<string, number> = {};
  let start = leading;
  for (const c of ordered) {
    if (effectivePin(c, pins) === 'start') {
      out[c.id] = start;
      start += widthOf(c.id);
    }
  }
  let end = 0;
  for (const c of [...ordered].reverse()) {
    if (effectivePin(c, pins) === 'end') {
      out[c.id] = end;
      end += widthOf(c.id);
    }
  }
  return out;
}

/** Header bands: consecutive columns sharing a `group` merge into one span. */
export function groupBands<R>(cols: Column<R>[]): { label: string | null; span: number; key: string }[] {
  const bands: { label: string | null; span: number; key: string }[] = [];
  for (const c of cols) {
    const label = c.group ?? null;
    const last = bands[bands.length - 1];
    if (last && last.label === label && label !== null) last.span += 1;
    else bands.push({ label, span: 1, key: `${label ?? '_'}-${c.id}` });
  }
  return bands;
}

export function buildDisplayRows<R>(
  rows: R[],
  rowKey: (r: R) => Key,
  opts: {
    groupBy?: GroupByConfig<R>;
    collapsed: Set<string>;
    expanded: Set<Key>;
    canExpand: boolean;
  },
): DisplayRow<R>[] {
  const out: DisplayRow<R>[] = [];
  let index = 0;
  const push = (row: R) => {
    const key = rowKey(row);
    out.push({ kind: 'row', id: `r:${String(key)}`, key, row, index: index++ });
    if (opts.canExpand && opts.expanded.has(key))
      out.push({ kind: 'detail', id: `d:${String(key)}`, key, row });
  };
  if (!opts.groupBy) {
    rows.forEach(push);
    return out;
  }
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    const k = opts.groupBy.key(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  for (const [groupKey, list] of groups) {
    const collapsed = Boolean(opts.groupBy.collapsible) && opts.collapsed.has(groupKey);
    out.push({ kind: 'group', id: `g:${groupKey}`, groupKey, rows: list, collapsed });
    if (!collapsed) list.forEach(push);
  }
  return out;
}

/** Keys between two rows (inclusive), in display order, honouring disabled rows. */
export function rangeKeys(order: Key[], from: Key, to: Key): Key[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

export interface PersistedState {
  widths: Record<string, number>;
  hidden: string[] | null;
  pins: Record<string, 'start' | 'end' | null>;
  density: Density | null;
  collapsed: string[];
}

export const EMPTY_STATE: PersistedState = {
  widths: {},
  hidden: null,
  pins: {},
  density: null,
  collapsed: [],
};

export function readPersisted(storageKey: string | undefined): PersistedState {
  if (!storageKey) return EMPTY_STATE;
  const v2 = readJson<Partial<PersistedState> | null>(KEYS.dataTableState(storageKey), null);
  // v1 stored only {id: px} widths; keep honouring them.
  const widths = v2?.widths ?? readJson<Record<string, number>>(KEYS.dataTableWidths(storageKey), {});
  return { ...EMPTY_STATE, ...v2, widths };
}

export function clampWidth<R>(col: Column<R>, w: number): number {
  const min = col.minWidth ?? DEFAULT_MIN_WIDTH;
  const max = col.maxWidth ?? 1200;
  return Math.round(Math.min(Math.max(w, min), max));
}

/** Truncate in the middle ("q-0…9f3a") for ids. */
export function middleTruncate(text: string, keep = 8): string {
  if (text.length <= keep * 2 + 1) return text;
  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}
