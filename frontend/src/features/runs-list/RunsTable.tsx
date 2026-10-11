/**
 * Hand-rolled runs table. DataTable (React Aria Table) cannot host an expanded
 * passes panel row, so this keeps the .qdt header/cell recipe, th[aria-sort],
 * roving row focus (j/k, arrows, Tab), a CSS-sticky Run column and a sticky
 * Actions column in plain <table> markup.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { RunRow } from '@/api/dashboardTypes';
import { Checkbox, EmptyState, Skeleton } from '@/ui';
import { formatNumericValue } from '@/lib/format';
import {
  AnalysisCell,
  DatasetCell,
  DateCell,
  DurationCell,
  ExperimentCell,
  LatencyCell,
  MetricCell,
  ModelCell,
  Mono,
  OwnerCell,
  RowActions,
  RunNameCell,
  Signals,
  StatusCell,
  VersionCell,
  type RowPermissions,
} from './cells';
import type { ColumnDef } from './columns';
import { PassesPanel } from './PassesPanel';
import { passRefBase, PASS_REF_SEP } from './selection';
import type { SortSpec } from './urlState';
import styles from './RunsTable.module.css';

export interface RunsTableProps {
  rows: RunRow[];
  columns: ColumnDef[];
  sort: SortSpec;
  onSort: (sortKey: string) => void;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (ref: string) => void;
  onSelectPage: (refs: string[], on: boolean) => void;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  focusedIndex: number;
  onFocusIndex: (i: number) => void;
  onOpen: (row: RunRow) => void;
  perm: RowPermissions;
  onAction: (id: string, row: RunRow) => void;
  onSignalDetails: (row: RunRow) => void;
  loading?: boolean;
  dimmed?: boolean;
  emptyState?: ReactNode;
  slug: string;
  className?: string;
}

function cellFor(col: ColumnDef, row: RunRow, p: RunsTableProps): ReactNode {
  if (col.id.startsWith('metric-')) return <MetricCell row={row} metric={col.id.slice(7)} />;
  if (col.id.startsWith('trace-')) {
    const v = row.trace_stats?.[col.id.slice(6)];
    if (typeof v !== 'number') return <span>—</span>;
    return <Mono>{col.id === 'trace-tool_success_rate' ? `${(v * 100).toFixed(1)}%` : formatNumericValue(v, 1)}</Mono>;
  }
  switch (col.id) {
    case 'run':
      return <RunNameCell row={row} expanded={p.expanded.has(row.run_id)} onToggleExpand={() => p.onToggleExpand(row.run_id)} />;
    case 'status':
      return <StatusCell row={row} />;
    case 'signals':
      return <Signals row={row} onDetails={p.onSignalDetails} />;
    case 'task':
      return <span title={row.task_name}>{row.task_name || '—'}</span>;
    case 'model':
      return <ModelCell row={row} />;
    case 'dataset':
      return <DatasetCell row={row} />;
    case 'owner':
      return <OwnerCell row={row} />;
    case 'time':
      return <DateCell row={row} />;
    case 'analysis':
      return <AnalysisCell row={row} />;
    case 'experiment':
      return <ExperimentCell row={row} />;
    case 'version':
      return <VersionCell row={row} />;
    case 'latency':
      return <LatencyCell ms={row.avg_latency_ms} />;
    case 'median-latency':
      return <LatencyCell ms={row.median_latency_ms} />;
    case 'duration':
      return <DurationCell ms={row.duration_ms} />;
    case 'actions':
      return <RowActions row={row} perm={p.perm} onAction={p.onAction} />;
    default:
      return null;
  }
}

export function RunsTable(p: RunsTableProps) {
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const cols = p.columns;
  const ids = p.rows.map((r) => r.run_id);
  const allOnPage = ids.length > 0 && ids.every((id) => p.selected.has(id));
  const someOnPage = ids.some((id) => p.selected.has(id) || hasPassSelected(p.selected, id));

  useEffect(() => {
    const el = rowRefs.current[p.focusedIndex];
    if (el && document.activeElement !== el && !el.contains(document.activeElement)) el.focus({ preventScroll: false });
  }, [p.focusedIndex]);

  if (p.loading) {
    return (
      <div className={styles.container} data-density="compact" aria-busy="true">
        <Skeleton kind="table" rows={12} label="Loading runs" />
      </div>
    );
  }

  const totalWidth = cols.reduce((n, c) => n + c.width, 0) + (p.selectMode ? 36 : 0);

  return (
    <div
      className={[styles.container, p.className].filter(Boolean).join(' ')}
      data-density="compact"
      data-sticky-first=""
      data-testid="runs-table"
    >
      <table className={styles.table} data-dimmed={p.dimmed ? '' : undefined} style={{ minWidth: totalWidth }} aria-label="Runs" aria-rowcount={p.rows.length}>
        <colgroup>
          {p.selectMode ? <col style={{ width: 36 }} /> : null}
          {cols.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className={styles.thead}>
          <tr>
            {p.selectMode ? (
              <th scope="col" className={styles.th} data-select>
                <Checkbox
                  aria-label="Select all runs on this page"
                  isSelected={allOnPage}
                  isIndeterminate={!allOnPage && someOnPage}
                  onChange={(on) => p.onSelectPage(ids, on)}
                />
              </th>
            ) : null}
            {cols.map((def, i) => {
              const sortable = Boolean(def.sortKey);
              const active = sortable && p.sort.field === def.sortKey;
              const ariaSort = active ? (p.sort.direction === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined;
              return (
                <th
                  key={def.id}
                  scope="col"
                  className={styles.th}
                  data-align={def.align}
                  data-first={i === 0 ? '' : undefined}
                  data-last={i === cols.length - 1 ? '' : undefined}
                  data-sorted={active ? p.sort.direction : undefined}
                  aria-sort={ariaSort}
                >
                  {sortable ? (
                    <AriaButton className={styles.sortButton} onPress={() => p.onSort(def.sortKey!)}>
                      <span className={styles.thLabel}>{def.label}</span>
                      <span className={styles.sortGlyph} data-active={active ? '' : undefined} aria-hidden="true">
                        {active ? (p.sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </AriaButton>
                  ) : (
                    <span className={styles.thLabel}>{def.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {p.rows.map((row, i) => {
            const isFocused = p.focusedIndex === i;
            const isSelected = p.selected.has(row.run_id);
            const partial = !isSelected && hasPassSelected(p.selected, row.run_id);
            const isExpanded = p.expanded.has(row.run_id);
            const name = row.external_run_id || row.run_name;
            return [
              <tr
                key={row.run_id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={styles.tr}
                tabIndex={isFocused || (p.focusedIndex < 0 && i === 0) ? 0 : -1}
                data-focused={isFocused ? '' : undefined}
                data-selected={isSelected ? '' : undefined}
                data-live={row.status === 'RUNNING' ? '' : undefined}
                data-status={row.status}
                data-run-id={row.run_id}
                aria-selected={p.selectMode ? isSelected : undefined}
                aria-rowindex={i + 1}
                onFocus={(e) => {
                  if (e.target === e.currentTarget && !isFocused) p.onFocusIndex(i);
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a, button, input, label, [role="button"]')) return;
                  p.onFocusIndex(i);
                  if (p.selectMode) p.onToggleSelect(row.run_id);
                }}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest('a, button, input, label, [role="button"]')) return;
                  p.onOpen(row);
                }}
              >
                {p.selectMode ? (
                  <td className={styles.td} data-select>
                    <Checkbox
                      aria-label={`Select ${name}`}
                      isSelected={isSelected}
                      isIndeterminate={partial}
                      onChange={() => p.onToggleSelect(row.run_id)}
                    />
                  </td>
                ) : null}
                {cols.map((def, ci) => (
                  <td
                    key={def.id}
                    className={styles.td}
                    data-align={def.align}
                    data-first={ci === 0 ? '' : undefined}
                    data-last={ci === cols.length - 1 ? '' : undefined}
                    data-col={def.id}
                  >
                    {cellFor(def, row, p)}
                  </td>
                ))}
              </tr>,
              isExpanded && row.samples > 1 ? (
                <tr key={`${row.run_id}-passes`} className={styles.panelRow}>
                  <td colSpan={cols.length + (p.selectMode ? 1 : 0)} className={styles.panelCell}>
                    <PassesPanel
                      row={row}
                      slug={p.slug}
                      selectMode={p.selectMode}
                      selected={p.selected}
                      onToggle={p.onToggleSelect}
                      canDelete={!p.perm.readOnly && (p.perm.isAdmin || p.perm.canManage || row.owner?.id === p.perm.meId)}
                    />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {p.rows.length === 0 ? (
        <div className={styles.emptyHost}>
          {p.emptyState ?? <EmptyState compact title="No runs match current filters" body="Clear a filter or widen the time range." />}
        </div>
      ) : null}
    </div>
  );
}

function hasPassSelected(selected: Set<string>, runId: string): boolean {
  for (const ref of selected) if (ref.startsWith(runId + PASS_REF_SEP) && passRefBase(ref) === runId) return true;
  return false;
}
