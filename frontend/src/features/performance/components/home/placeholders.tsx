/**
 * Performance pages: the loading rows of a table (§7 "A loading frame is the loaded layout"). A placeholder row goes
 * through the table's own columns, so it has the loaded row's height in the table and in card mode, and each cell
 * draws Skeleton shapes instead of values. The number of rows follows the data the page already has
 * (`loadingRowCount`), else the table's own default of eight.
 */
import type { ReactNode } from 'react';
import { Skeleton, type CellCtx, type Column } from '@/ui';
import styles from './home.module.css';

const DEFAULT_ROWS = 8;
const MARK = Symbol('placeholder');

export interface Placeholder {
  readonly [MARK]: true;
  readonly id: string;
}

export function isPlaceholder(row: unknown): row is Placeholder {
  return typeof row === 'object' && row !== null && MARK in row;
}

export function placeholderRows(count: number): Placeholder[] {
  return Array.from({ length: count }, (_, index) => ({ [MARK]: true as const, id: `placeholder-${index}` }));
}

/**
 * How many placeholder rows a loading table draws: the count the data already on the page says will arrive (a total,
 * capped at the page size, §7), else the table's own default.
 */
export function loadingRowCount(total: number | null | undefined, pageSize: number): number {
  return total === null || total === undefined ? DEFAULT_ROWS : Math.max(1, Math.min(total, pageSize));
}

/** A bone as tall as a tag (a StateTag, a dataset tag, a person): for a cell whose loaded value is one. */
export const tagShape = (label = 'Loading') => (
  <Skeleton kind="value" height="var(--badge-height)" label={label} />
);

/** One skeleton line per line the loaded cell draws (a two-line cell gets two). */
export function skeletonLines(lines = 1, label = 'Loading'): ReactNode {
  return (
    <span className={styles.skeletonLines}>
      {/* Each bone sits in a line box of the cell's own line height, so N bones are as tall as N lines of text. */}
      {Array.from({ length: lines }, (_, index) => (
        <span key={index}>
          <Skeleton kind="value" label={label} />
        </span>
      ))}
    </span>
  );
}

/**
 * The table's columns, with a placeholder row drawing skeleton lines in every cell. `lines` names the columns whose
 * loaded cell is more than one line, and `shapes` the cells that draw something taller than a text line (a tag).
 */
export function withPlaceholders<R>(
  columns: Column<R>[],
  options: { lines?: Record<string, number>; shapes?: Record<string, ReactNode> } = {},
): Column<R | Placeholder>[] {
  return columns.map((column) => ({
    ...column,
    cell: (row: R | Placeholder, ctx: CellCtx) =>
      isPlaceholder(row)
        ? (options.shapes?.[column.id] ??
          skeletonLines(options.lines?.[column.id] ?? 1, `Loading: ${column.id}`))
        : column.cell?.(row, ctx),
  })) as Column<R | Placeholder>[];
}
