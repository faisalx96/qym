import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Cell,
  Column,
  ColumnResizer,
  ResizableTableContainer,
  Row,
  Table,
  TableBody,
  TableHeader,
  type SortDescriptor,
  type Key,
} from 'react-aria-components';
import { KEYS, readJson, writeJson } from '@/lib/storage';
import { Checkbox } from '../Checkbox';
import styles from './DataTable.module.css';

export interface Column<Row> {
  id: string;
  label: ReactNode;
  /** Sort key (enables sorting). */
  sortKey?: string;
  width?: number;
  minWidth?: number;
  /** Absorbs leftover width unless the user resized it. */
  flex?: boolean;
  align?: 'start' | 'end';
  mono?: boolean;
  cell?: (row: Row) => ReactNode;
  resizable?: boolean;
  /** Hidden from the header text (icon/actions column). */
  hideLabel?: boolean;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => Key;
  storageKey?: string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  onRowAction?: (key: Key, row: Row) => void;
  stickyHeader?: boolean;
  minWidth?: number;
  hiddenColumns?: string[];
  emptyState?: ReactNode;
  'aria-label': string;
  className?: string;
  /** Row-level href makes rows links (keyboard: Enter). */
  rowHref?: (row: Row) => string | undefined;
  selection?: {
    selected: Set<Key>;
    onChange: (keys: Set<Key>) => void;
    mode?: 'multiple' | 'single';
    /** Rows that cannot be selected (the checkbox is disabled, the row stays otherwise usable). */
    isDisabled?: (row: Row) => boolean;
  };
  dimmed?: boolean;
}

type Widths = Record<string, number>;

/**
 * .qdt-table: sticky uppercase --font-sm muted header, --font-base secondary
 * cells, sortable `th[aria-sort]`, resize by pointer and keyboard, widths
 * persisted under localStorage 'qym:data-table:widths:<storageKey>' as {id: px}.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  storageKey,
  sort,
  onSortChange,
  onRowAction,
  stickyHeader = true,
  minWidth,
  hiddenColumns,
  emptyState,
  className,
  rowHref,
  selection,
  dimmed,
  ...rest
}: DataTableProps<Row>) {
  const visible = useMemo(
    () => columns.filter((c) => !hiddenColumns?.includes(c.id)),
    [columns, hiddenColumns],
  );
  const [widths, setWidths] = useState<Widths>(() =>
    storageKey ? readJson<Widths>(KEYS.dataTableWidths(storageKey), {}) : {},
  );
  const onResizeEnd = useCallback(
    (next: Map<Key, number | string>) => {
      const out: Widths = { ...widths };
      next.forEach((w, k) => {
        if (typeof w === 'number') out[String(k)] = Math.round(w);
      });
      setWidths(out);
      if (storageKey) writeJson(KEYS.dataTableWidths(storageKey), out);
    },
    [storageKey, widths],
  );
  const sortDescriptor: SortDescriptor | undefined = sort
    ? { column: sort.key, direction: sort.direction === 'asc' ? 'ascending' : 'descending' }
    : undefined;
  const sortColumnId = (key: string) => visible.find((c) => c.sortKey === key || c.id === key)?.id;

  return (
    <ResizableTableContainer
      className={[styles.container, className].filter(Boolean).join(' ')}
      onResizeEnd={onResizeEnd}
    >
      <Table
        className={styles.table}
        data-sticky={stickyHeader ? '' : undefined}
        data-dimmed={dimmed ? '' : undefined}
        style={{ minWidth }}
        sortDescriptor={sortDescriptor}
        onSortChange={(d) => {
          const col = visible.find((c) => c.id === String(d.column));
          if (col && onSortChange)
            onSortChange({
              key: col.sortKey ?? col.id,
              direction: d.direction === 'ascending' ? 'asc' : 'desc',
            });
        }}
        selectionMode={selection?.mode ?? (selection ? 'multiple' : 'none')}
        selectedKeys={selection?.selected}
        disabledKeys={selection?.isDisabled ? rows.filter(selection.isDisabled).map(rowKey) : undefined}
        disabledBehavior="selection"
        onSelectionChange={(keys) => {
          if (!selection) return;
          selection.onChange(
            keys === 'all'
              ? new Set(rows.filter((r) => !selection.isDisabled?.(r)).map(rowKey))
              : new Set(keys),
          );
        }}
        onRowAction={
          onRowAction
            ? (key) => {
                const row = rows.find((r) => rowKey(r) === key);
                if (row) onRowAction(key, row);
              }
            : undefined
        }
        {...rest}
      >
        <TableHeader className={styles.thead}>
          {selection && (selection.mode ?? 'multiple') === 'multiple' ? (
            <Column
              id="__select"
              width={40}
              minWidth={40}
              maxWidth={40}
              className={styles.th}
              aria-label="Select"
            >
              <Checkbox slot="selection" aria-label="Select all rows" hideLabel />
            </Column>
          ) : null}
          {visible.map((col, i) => (
            <Column
              key={col.id}
              id={col.id}
              isRowHeader={i === 0}
              allowsSorting={Boolean(col.sortKey) && Boolean(onSortChange)}
              width={widths[col.id]}
              defaultWidth={col.flex ? '1fr' : col.width}
              minWidth={col.minWidth ?? 44}
              className={styles.th}
              data-align={col.align}
              data-sorted={sort && sortColumnId(sort.key) === col.id ? sort.direction : undefined}
            >
              {({ allowsSorting, sortDirection }) => (
                <div className={styles.thInner}>
                  <span
                    className={styles.thLabel}
                    data-hidden={col.hideLabel ? '' : undefined}
                    title={typeof col.label === 'string' ? col.label : undefined}
                  >
                    {col.label}
                  </span>
                  {allowsSorting ? (
                    <span
                      className={styles.sortGlyph}
                      aria-hidden="true"
                      data-active={sortDirection ? '' : undefined}
                    >
                      {sortDirection === 'ascending' ? '↑' : sortDirection === 'descending' ? '↓' : '↕'}
                    </span>
                  ) : null}
                  {col.resizable !== false ? (
                    <ColumnResizer
                      className={styles.resizer}
                      aria-label={`Resize ${typeof col.label === 'string' ? col.label : col.id}`}
                    />
                  ) : null}
                </div>
              )}
            </Column>
          ))}
        </TableHeader>
        <TableBody
          className={styles.tbody}
          items={rows.map((row) => ({ id: rowKey(row), row }))}
          renderEmptyState={() => <div className={styles.empty}>{emptyState ?? 'Nothing to show'}</div>}
        >
          {(item) => (
            <Row id={item.id} className={styles.tr} href={rowHref?.(item.row)}>
              {selection && (selection.mode ?? 'multiple') === 'multiple' ? (
                <Cell className={styles.td}>
                  <Checkbox slot="selection" aria-label="Select row" hideLabel />
                </Cell>
              ) : null}
              {visible.map((col) => (
                <Cell
                  key={col.id}
                  className={styles.td}
                  data-align={col.align}
                  data-mono={col.mono ? '' : undefined}
                >
                  {col.cell
                    ? col.cell(item.row)
                    : String((item.row as Record<string, unknown>)[col.id] ?? '')}
                </Cell>
              ))}
            </Row>
          )}
        </TableBody>
      </Table>
    </ResizableTableContainer>
  );
}
