import type { ReactNode } from 'react';

/** Row identity (matches React Aria's Key so existing Set<Key> state keeps working). */
export type Key = string | number;

export type Density = 'compact' | 'regular' | 'comfortable';
export type CellType =
  'text' | 'id' | 'number' | 'score' | 'delta' | 'date' | 'duration' | 'status' | 'tags' | 'actions';

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface SortSpec<R> {
  key: string;
  /** Direction of the first click (default asc). */
  first?: 'asc' | 'desc';
  /** Client-side comparator (ascending); used when the table sorts itself. */
  compare?: (a: R, b: R) => number;
}

export interface CellCtx {
  index: number;
  density: Density;
  /** True inside the stacked card layout (below 640 px). */
  card: boolean;
}

export interface Column<R> {
  id: string;
  header?: ReactNode;
  /** Plain-text name (card-mode keys, header aria-label, column menu) when `header` is not a string. */
  label?: string;
  /** HelpMarker-style hint rendered after the header text (title attribute). */
  hint?: string;
  /** Header band, e.g. 'Metrics'. Adjacent columns of one group share the band. */
  group?: string;
  type?: CellType;
  accessor?: (r: R) => unknown;
  cell?: (r: R, ctx: CellCtx) => ReactNode;
  /** Muted second line (forces at least the regular row height). */
  secondary?: (r: R) => ReactNode;
  sort?: string | SortSpec<R>;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Absorbs leftover width unless the user resized it. */
  flex?: boolean;
  pin?: 'start' | 'end';
  /** The column keeps its declared position: not reorderable in the Columns menu, ignores the saved order. */
  lockOrder?: boolean;
  resizable?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
  /** Card mode: 1 = headline, 2 = body grid, 3 = detail only. Unset = not shown in cards. */
  priority?: 1 | 2 | 3;
  /** Card mode: this column leads the card (default: the first priority-1 column). */
  cardTitle?: boolean;
  truncate?: 'end' | 'middle';
  /** Clamp text to n lines (forces at least the regular row height). */
  wrap?: number;
  summary?: ReactNode | ((rows: R[]) => ReactNode);
  /** A filter targets this column: dot in the header. */
  filtered?: boolean;
  /** Overrides the alignment derived from `type`. */
  align?: 'start' | 'end';
  /** Overrides the mono default derived from `type`. */
  mono?: boolean;
  /** Icon/actions column: header text is visually hidden. */
  hideLabel?: boolean;
}

export interface RowAction<R> {
  id: string;
  label: string;
  /** An Icon name or a node. */
  icon?: string | ReactNode;
  /** Primary actions render as icon buttons; the rest go to the overflow menu. */
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  onPress: (row: R) => void;
}

export type RowStateKind = 'error' | 'warn' | 'live' | 'new';

export interface SelectionConfig<R> {
  selected: Set<Key>;
  onChange: (keys: Set<Key>) => void;
  mode?: 'multiple' | 'single';
  /** Rows that cannot be selected (the checkbox is disabled, the row stays otherwise usable). */
  isDisabled?: (row: R) => boolean;
  /** Partly selected (e.g. some passes of a repeat run): indeterminate checkbox. */
  isIndeterminate?: (row: R) => boolean;
  /** Server-paged tables: "Select all N matching" banner after a page is selected. */
  selectAllMatching?: { total: number; onSelectAll: () => void; noun?: string };
}

export interface GroupByConfig<R> {
  key: (row: R) => string;
  label: (key: string, rows: R[]) => ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/** One physical body row after grouping/expansion. */
export type DisplayRow<R> =
  | { kind: 'group'; id: string; groupKey: string; rows: R[]; collapsed: boolean }
  | { kind: 'row'; id: string; key: Key; row: R; index: number }
  | {
      kind: 'child';
      id: string;
      key: Key;
      row: R;
      /** Index of the parent row among data rows (cells read it as their row index). */
      index: number;
      parentKey: Key;
      parentRow: R;
      /** 1-based position among the parent's children and the number of children (aria-posinset / setsize). */
      posinset: number;
      setsize: number;
    }
  | { kind: 'detail'; id: string; key: Key; row: R };

/**
 * Child rows of an expanded row: ordinary rows of the same table (same columns, order, widths, frozen set).
 * `detail` (default true) also draws the row's `renderExpanded` block after the last child.
 */
export interface ChildRows<R> {
  rows: R[];
  /** aria-setsize of the children when it is not rows.length (queued passes count). */
  setsize?: number;
  detail?: boolean;
}
