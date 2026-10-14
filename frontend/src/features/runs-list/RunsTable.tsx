/**
 * The runs list table: columns, cells and runs-specific selection rules on the
 * shared DataTable (pinned Run and Actions columns, header bands, zebra rows,
 * passes panel as the expanded row, select mode as `selection`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { RunRow } from '@/api/dashboardTypes';
import {
  DataTable,
  EmptyState,
  TaskTag,
  type Column,
  type FooterProps,
  type Key,
  type ToolbarProps,
} from '@/ui';
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
import { passRef, passRefBase, PASS_REF_SEP } from './selection';
import { defaultDirection, type SortSpec } from './urlState';
import styles from './RunsTable.module.css';

export interface RunsTableProps {
  rows: RunRow[];
  /** Every column in default order; the table owns visibility, order and freezing. */
  columns: ColumnDef[];
  /** Column ids hidden until the user chooses. */
  defaultHidden?: Set<string>;
  /** Layouts are saved per user. */
  storageScope?: string;
  onHiddenChange?: (hidden: Set<string>) => void;
  sort: SortSpec;
  /** `null` clears the sort (back to the default order). */
  onSort: (sortKey: string | null, direction?: 'asc' | 'desc') => void;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (ref: string) => void;
  onSelectPage: (refs: string[], on: boolean) => void;
  onNotePassRevision?: (runId: string, revision: number) => void;
  onPassesDeleted?: (runId: string) => void;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  focusedIndex: number;
  onFocusIndex: (i: number) => void;
  onOpen: (row: RunRow) => void;
  perm: RowPermissions;
  onAction: (id: string, row: RunRow) => void;
  onSignalDetails: (row: RunRow, metric?: string) => void;
  loading?: boolean | 'quiet';
  error?: unknown;
  onRetry?: () => void;
  dimmed?: boolean;
  /** DataTable.Toolbar props (search, filters, chips, trailing). */
  toolbar?: ToolbarProps;
  /** DataTable.Footer props (summary, pagination, trailing). */
  footer?: FooterProps;
  /** Selection cluster (Compare, Cohort, ...), shown in the toolbar in select mode. */
  bulk?: ReactNode;
  emptyState?: ReactNode;
  slug: string;
  className?: string;
}

function cellFor(col: ColumnDef, row: RunRow, p: RunsTableProps): ReactNode {
  if (col.id.startsWith('metric-'))
    return <MetricCell row={row} metric={col.id.slice(7)} onErrorDetails={p.onSignalDetails} />;
  if (col.id.startsWith('trace-')) {
    const v = row.trace_stats?.[col.id.slice(6)];
    if (typeof v !== 'number') return <span>—</span>;
    return (
      <Mono>
        {col.id === 'trace-tool_success_rate' ? `${(v * 100).toFixed(1)}%` : formatNumericValue(v, 1)}
      </Mono>
    );
  }
  switch (col.id) {
    case 'run':
      return (
        <RunNameCell
          row={row}
          expanded={p.expanded.has(row.run_id)}
          onToggleExpand={() => p.onToggleExpand(row.run_id)}
        />
      );
    case 'status':
      return <StatusCell row={row} />;
    case 'signals':
      return <Signals row={row} onDetails={(r) => p.onSignalDetails(r)} />;
    case 'task':
      return <TaskTag name={row.task_name} />;
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

const GROUP_LABEL: Record<string, string> = {
  metrics: 'Scores',
  system: 'System',
  trace: 'Trace',
  group: 'Repeat runs',
};

/** Header bands: Overview (Run, Status, Signals), Scores, Context (Date, Task, ...), System, Trace. */
function bandOf(def: ColumnDef): string | undefined {
  if (def.group !== 'run') return GROUP_LABEL[def.group];
  if (def.id === 'actions') return undefined;
  return ['run', 'status', 'signals'].includes(def.id) ? 'Overview' : 'Context';
}

/** Card layout (< 640 px): Run + Status + actions up top, model/date/first scores below, the rest behind More. */
function priorityOf(col: ColumnDef, metricRank: number): 1 | 2 | 3 {
  if (col.id === 'run' || col.id === 'status' || col.id === 'actions') return 1;
  if (col.id === 'model' || col.id === 'time') return 2;
  if (col.id.startsWith('metric-')) return metricRank < 2 ? 2 : 3;
  return 3;
}

/** Run + Status stay frozen on wide screens; narrower ones freeze Run only (the 50% cap suspends the rest). */
function useWideDefault(): boolean {
  const [wide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1440px)').matches === true,
  );
  return wide;
}

export function RunsTable(p: RunsTableProps) {
  const wide = useWideDefault();
  const passRefsOf = (row: RunRow) =>
    Array.from({ length: row.samples }, (_, i) => passRef(row.run_id, i + 1));
  // An expanded repeat run is checked through its passes: all ticked = checked, some = indeterminate.
  const viaPasses = (row: RunRow) => row.samples > 1 && p.expanded.has(row.run_id);
  const rowChecked = (row: RunRow) =>
    p.selected.has(row.run_id) || (viaPasses(row) && passRefsOf(row).every((ref) => p.selected.has(ref)));
  const toggleRow = (row: RunRow) => {
    if (!viaPasses(row)) return p.onToggleSelect(row.run_id);
    p.onSelectPage(passRefsOf(row), !rowChecked(row));
    if (p.selected.has(row.run_id)) p.onSelectPage([row.run_id], false);
  };

  const columns = useMemo<Column<RunRow>[]>(() => {
    let metricRank = 0;
    return p.columns.map((def) => {
      const rank = def.id.startsWith('metric-') ? metricRank++ : 0;
      return {
        id: def.id,
        header: def.label,
        hint: def.label,
        group: bandOf(def),
        sort: def.sortKey ? { key: def.sortKey, first: defaultDirection(def.sortKey) } : undefined,
        width: def.width,
        align: def.align,
        pin:
          def.id === 'run' || (wide && def.id === 'status')
            ? 'start'
            : def.id === 'actions'
              ? 'end'
              : undefined,
        lockOrder: def.id === 'actions',
        hideable: def.visKey !== null && def.id !== 'run',
        defaultHidden: p.defaultHidden?.has(def.id),
        resizable: def.id !== 'actions',
        hideLabel: def.id === 'actions',
        priority: priorityOf(def, rank),
        cell: (row: RunRow) => cellFor(def, row, p),
      } satisfies Column<RunRow>;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cells read the live props through `p`
  }, [p.columns, p.defaultHidden, wide, p.expanded, p.perm, p.onAction, p.onSignalDetails, p.onToggleExpand]);

  const selected = useMemo(() => {
    const out = new Set<Key>();
    for (const row of p.rows) if (rowChecked(row)) out.add(row.run_id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from the selection and expansion sets
  }, [p.rows, p.selected, p.expanded]);

  return (
    <div className={[styles.host, p.className].filter(Boolean).join(' ')} data-testid="runs-table">
      <DataTable<RunRow>
        aria-label="Runs"
        storageKey="runs.v2"
        storageScope={p.storageScope}
        reorderable
        onHiddenChange={p.onHiddenChange}
        density="compact"
        columns={columns}
        rows={p.rows}
        rowKey={(r) => r.run_id}
        loading={p.loading}
        refreshing={p.dimmed}
        empty={
          p.emptyState ?? (
            <EmptyState
              compact
              title="No runs match current filters"
              body="Clear a filter or widen the time range."
            />
          )
        }
        sort={{ key: p.sort.field, direction: p.sort.direction }}
        allowUnsorted
        onSortChange={(s) => (s ? p.onSort(s.key, s.direction) : p.onSort(null))}
        error={p.error}
        onRetry={p.onRetry}
        errorTitle="Could not load runs"
        bulkActions={p.selectMode ? p.bulk : undefined}
        bulkOwnSummary
        bulkAlways={p.selectMode}
        onRowOpen={p.onOpen}
        rowState={(r) => (r.status === 'RUNNING' ? 'live' : r.status === 'FAILED' ? 'error' : undefined)}
        rowProps={(r) => ({
          'data-run-id': r.run_id,
          'data-status': r.status,
          'data-live': r.status === 'RUNNING' ? '' : undefined,
        })}
        selection={
          p.selectMode
            ? {
                selected,
                onChange: (next) => {
                  for (const row of p.rows)
                    if (next.has(row.run_id) !== selected.has(row.run_id)) toggleRow(row);
                },
                isIndeterminate: (row) => !rowChecked(row) && hasPassSelected(p.selected, row.run_id),
              }
            : undefined
        }
        rowLabel={(r) => `Select ${r.external_run_id || r.run_name}`}
        selectAllLabel="Select all runs on this page"
        selectOnRowClick={p.selectMode}
        expandColumn={false}
        canExpand={(r) => r.samples > 1}
        expanded={p.expanded}
        onExpandedChange={(next) => {
          for (const row of p.rows)
            if (next.has(row.run_id) !== p.expanded.has(row.run_id)) p.onToggleExpand(row.run_id);
        }}
        renderExpanded={(row) => (
          <PassesPanel
            row={row}
            slug={p.slug}
            selectMode={p.selectMode}
            selected={p.selected}
            onToggle={p.onToggleSelect}
            onNotePassRevision={p.onNotePassRevision}
            onPassesDeleted={p.onPassesDeleted}
            canDelete={
              !p.perm.readOnly && (p.perm.isAdmin || p.perm.canManage || row.owner?.id === p.perm.meId)
            }
          />
        )}
        focusedKey={p.focusedIndex >= 0 ? (p.rows[p.focusedIndex]?.run_id ?? null) : null}
        onFocusedKeyChange={(key) =>
          p.onFocusIndex(key === null ? -1 : p.rows.findIndex((r) => r.run_id === key))
        }
      >
        <DataTable.Toolbar columnsMenu {...p.toolbar} />
        <DataTable.Footer testId="status-bar" ariaLabel="Runs status" {...p.footer} />
      </DataTable>
    </div>
  );
}

function hasPassSelected(selected: Set<string>, runId: string): boolean {
  for (const ref of selected)
    if (ref.startsWith(runId + PASS_REF_SEP) && passRefBase(ref) === runId) return true;
  return false;
}
