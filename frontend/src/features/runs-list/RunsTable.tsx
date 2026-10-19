/**
 * The runs list table: columns, cells and runs-specific selection rules on the
 * shared DataTable (pinned Run and Actions columns, header bands, zebra rows,
 * passes panel as the expanded row, select mode as `selection`).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunRow } from '@/api/dashboardTypes';
import { useDeletePasses, useRunPassesMany } from '@/api/dashboard';
import {
  DataTable,
  ConfirmDialog,
  EmptyState,
  TaskTag,
  useToast,
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
import { useRunsCtx } from './context';
import { isActiveRun } from './polling';
import { PassGroupStrip } from './passes/PassGroupStrip';
import { usePassesPrefetch } from './passes/usePassesPrefetch';
import {
  ErrorRetry,
  IssuesCell,
  PassActions,
  PassAnalysis,
  PassDate,
  PassMetricCell,
  PassNameCell,
  PassStatus,
  QueuedNameCell,
  QueuedStatus,
} from './passes/PassCells';
import { passHref } from './passes/links';
import { passIssues, readStoredMetric, writeStoredMetric } from './passes/model';
import { childRowsOf, resolveMetric, runKeyOf, type ChildOf, type TableRow } from './passes/rows';
import { defaultMetricName } from './chartModel';
import { isPassRef, passRef, passRefBase, PASS_REF_SEP } from './selection';
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

interface CellHandlers {
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onDeletePass: (run: RunRow, n: number) => void;
  onOpenPass: (run: RunRow, n: number) => void;
  canDeletePass: (run: RunRow) => boolean;
}

function runCell(col: ColumnDef, row: RunRow, p: RunsTableProps, h: CellHandlers): ReactNode {
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
          expanded={h.expanded.has(row.run_id)}
          onToggleExpand={() => h.onToggleExpand(row.run_id)}
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

/**
 * A child row shows the pass's own values in the run's columns. Task, Model, Dataset, Owner, Experiment and
 * Version are facts of the run and stay empty; the group columns (Pass@k ...) belong to the strip.
 */
function childCell(col: ColumnDef, tr: ChildOf, h: CellHandlers): ReactNode {
  const id = col.id;
  if (tr.kind === 'loading')
    return id === 'status' ? <span className={styles.childNote}>Loading passes…</span> : null;
  if (tr.kind === 'error') {
    if (id === 'status') return <span className={styles.childError}>Could not load passes</span>;
    if (id === 'actions') return <ErrorRetry onRetry={tr.retry} />;
    return null;
  }
  if (tr.kind === 'queued') {
    if (id === 'run') return <QueuedNameCell queued={tr.queued} />;
    if (id === 'status') return <QueuedStatus queued={tr.queued} />;
    return null;
  }
  const { run, pass, status } = tr;
  if (id.startsWith('metric-')) return <PassMetricCell run={run} pass={pass} metric={id.slice(7)} />;
  if (id.startsWith('trace-')) {
    const v = pass.trace_stats?.[id.slice(6)];
    if (typeof v !== 'number') return <span>—</span>;
    return (
      <Mono>{id === 'trace-tool_success_rate' ? `${(v * 100).toFixed(1)}%` : formatNumericValue(v, 1)}</Mono>
    );
  }
  switch (id) {
    case 'run':
      return <PassNameCell run={run} pass={pass} status={status} />;
    case 'status':
      return <PassStatus status={status} />;
    case 'signals':
      return <IssuesCell issues={passIssues(pass)} />;
    case 'time':
      return <PassDate pass={pass} />;
    case 'analysis':
      return <PassAnalysis run={run} pass={pass} status={status} />;
    case 'latency':
      return <LatencyCell ms={pass.avg_latency_ms} />;
    case 'median-latency':
      return <LatencyCell ms={pass.median_latency_ms} />;
    case 'duration':
      return <DurationCell ms={pass.duration_ms} />;
    case 'actions':
      return (
        <PassActions
          run={run}
          pass={pass}
          canDelete={h.canDeletePass(run)}
          onDelete={(n) => h.onDeletePass(run, n)}
          onOpen={(n) => h.onOpenPass(run, n)}
        />
      );
    default:
      return null;
  }
}

function cellFor(col: ColumnDef, tr: TableRow, p: RunsTableProps, h: CellHandlers): ReactNode {
  return tr.kind === 'run' ? runCell(col, tr.row, p, h) : childCell(col, tr, h);
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

const runName = (r: RunRow) => r.external_run_id || r.run_name || r.run_id.slice(0, 8);

export function RunsTable(p: RunsTableProps) {
  const wide = useWideDefault();
  const { slug: ctxSlug, listContext, metricTypes: prefetchMetricTypes } = useRunsCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeletePasses(p.slug);
  const [deleting, setDeleting] = useState<{ run: RunRow; n: number } | null>(null);
  const [childFocus, setChildFocus] = useState<Key | null>(null);
  const memSlug = ctxSlug || p.slug;
  const [choice, setChoice] = useState<string | null>(() => readStoredMetric(memSlug));
  const chooseMetric = (m: string) => {
    setChoice(m);
    writeStoredMetric(memSlug, m);
  };
  // Warm the passes and the strip statistics of the page's finished repeat runs once the list has settled (round 7, Q2)
  usePassesPrefetch(p.rows, choice, prefetchMetricTypes);

  const runRows = useMemo<TableRow[]>(
    () => p.rows.map((row) => ({ kind: 'run' as const, key: row.run_id, row })),
    [p.rows],
  );
  // The open groups: one passes query each (cached, shared with the strip); live runs refetch every 15 s.
  const openRuns = useMemo(
    () => p.rows.filter((r) => r.samples > 1 && p.expanded.has(r.run_id)),
    [p.rows, p.expanded],
  );
  const passQs = useRunPassesMany(
    openRuns.map((r) => ({ runId: r.run_id, refetchInterval: isActiveRun(r) ? 15_000 : false })),
  );
  const passesOf = (runId: string) => passQs[openRuns.findIndex((r) => r.run_id === runId)];
  const openIds = useMemo(() => new Set<string>(openRuns.map((r) => r.run_id)), [openRuns]);
  const openKey = openRuns.map((r) => `${r.run_id}:${r.pass_revision ?? 0}`).join(',');
  const notePassRevision = p.onNotePassRevision;
  useEffect(() => {
    // Records the pass revision these refs were picked against (stale picks drop out when it changes).
    for (const r of openRuns) notePassRevision?.(r.run_id, r.pass_revision ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openKey carries run ids and revisions
  }, [openKey]);

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
  const canDeletePass = (run: RunRow) =>
    !p.perm.readOnly &&
    (p.perm.isAdmin || p.perm.canManage || run.owner?.id === p.perm.meId) &&
    !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(run.status);
  const openPass = (run: RunRow, n: number) =>
    navigate(passHref(ctxSlug || p.slug, listContext, run.run_id, n));

  const columns = useMemo<Column<TableRow>[]>(() => {
    let metricRank = 0;
    const h: CellHandlers = {
      expanded: p.expanded,
      onToggleExpand: p.onToggleExpand,
      onDeletePass: (run, n) => setDeleting({ run, n }),
      onOpenPass: openPass,
      canDeletePass,
    };
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
        cell: (tr: TableRow) => cellFor(def, tr, p, h),
      } satisfies Column<TableRow>;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cells read the live props through `p`
  }, [p.columns, p.defaultHidden, wide, p.expanded, p.perm, p.onAction, p.onSignalDetails, p.onToggleExpand]);

  // The DataTable's selection: checked runs, plus every picked pass (and the passes of a run picked whole).
  const selected = useMemo(() => {
    const out = new Set<Key>();
    for (const row of p.rows) {
      if (rowChecked(row)) out.add(row.run_id);
      if (viaPasses(row) && p.selected.has(row.run_id)) for (const ref of passRefsOf(row)) out.add(ref);
    }
    for (const ref of p.selected) if (isPassRef(ref)) out.add(ref);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from the selection and expansion sets
  }, [p.rows, p.selected, p.expanded]);

  const applySelection = (next: Set<Key>) => {
    const byId = new Map(p.rows.map((r) => [r.run_id, r]));
    const runs: RunRow[] = [];
    const passes: Array<{ ref: string; on: boolean }> = [];
    for (const key of new Set<Key>([...selected, ...next])) {
      const on = next.has(key);
      if (on === selected.has(key)) continue;
      const ref = String(key);
      if (isPassRef(ref)) passes.push({ ref, on });
      else {
        const row = byId.get(ref);
        if (row) runs.push(row);
      }
    }
    for (const row of runs) toggleRow(row);
    for (const { ref, on } of passes) {
      const row = byId.get(passRefBase(ref));
      // a run picked whole becomes its passes, so one of them can be unticked
      if (row && !on && p.selected.has(row.run_id)) p.onSelectPage(passRefsOf(row), true);
      p.onSelectPage([ref], on);
    }
  };

  const focusRun = p.focusedIndex >= 0 ? (p.rows[p.focusedIndex]?.run_id ?? null) : null;
  const focusedKey: Key | null =
    childFocus !== null && focusRun !== null && runKeyOf(String(childFocus)) === focusRun
      ? childFocus
      : focusRun;
  const passQ = (run: RunRow) => passesOf(run.run_id);
  const activeFor = (run: RunRow) => {
    const data = passQ(run)?.data;
    const score = (data?.metrics ?? run.metrics).filter((m) => ctxMetricTypes[m] !== 'numeric');
    return resolveMetric(choice, score, defaultMetricName(score, run.metric_specs) ?? null);
  };
  const { metricTypes: ctxMetricTypes } = useRunsCtx();
  const cardMetric = openRuns[0] ? activeFor(openRuns[0]) : null;

  return (
    <div className={[styles.host, p.className].filter(Boolean).join(' ')} data-testid="runs-table">
      <DataTable<TableRow>
        aria-label="Runs"
        storageKey="runs.v2"
        storageScope={p.storageScope}
        reorderable
        onHiddenChange={p.onHiddenChange}
        density="compact"
        columns={columns}
        rows={runRows}
        rowKey={(r) => r.key}
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
        onRowOpen={(tr) => {
          if (tr.kind === 'run') p.onOpen(tr.row);
          else if (tr.kind === 'pass') openPass(tr.run, tr.pass.pass_number);
        }}
        rowState={(tr) =>
          tr.kind !== 'run'
            ? undefined
            : tr.row.status === 'RUNNING'
              ? 'live'
              : tr.row.status === 'FAILED'
                ? 'error'
                : undefined
        }
        rowProps={(tr) =>
          tr.kind === 'run'
            ? {
                'data-run-id': tr.row.run_id,
                'data-status': tr.row.status,
                'data-live': tr.row.status === 'RUNNING' ? '' : undefined,
                'aria-busy': passesOf(tr.row.run_id)?.isPending ? 'true' : undefined,
              }
            : tr.kind === 'pass'
              ? {
                  'data-pass-row': String(tr.pass.pass_number),
                  'data-parent-run': tr.run.run_id,
                  'data-status': tr.status.toUpperCase(),
                }
              : { [`data-${tr.kind}-row`]: '', 'data-parent-run': tr.run.run_id }
        }
        selection={
          p.selectMode
            ? {
                selected,
                onChange: applySelection,
                isDisabled: (tr) => tr.kind === 'loading' || tr.kind === 'error' || tr.kind === 'queued',
                isIndeterminate: (tr) =>
                  tr.kind === 'run' && !rowChecked(tr.row) && hasPassSelected(p.selected, tr.row.run_id),
              }
            : undefined
        }
        rowLabel={(tr) =>
          tr.kind === 'run'
            ? `Select ${runName(tr.row)}`
            : tr.kind === 'pass'
              ? `Select pass ${tr.pass.pass_number} of ${tr.run.samples} of run ${runName(tr.run)}`
              : 'Select row'
        }
        selectAllLabel="Select all runs on this page"
        selectOnRowClick={p.selectMode}
        expandColumn={false}
        canExpand={(tr) => tr.kind === 'run' && tr.row.samples > 1}
        expanded={openIds}
        onExpandedChange={(next) => {
          for (const row of p.rows)
            if (next.has(row.run_id) !== openIds.has(row.run_id)) p.onToggleExpand(row.run_id);
        }}
        childRows={(tr) =>
          tr.kind === 'run' && tr.row.samples > 1 ? childRowsOf(tr.row, passQ(tr.row)) : undefined
        }
        childLabel={(tr, parent) =>
          tr.kind === 'pass'
            ? `Pass ${tr.pass.pass_number} of ${parent.kind === 'run' ? parent.row.samples : ''} of run ${runName(tr.run)}`
            : tr.kind === 'queued'
              ? 'Passes waiting to start'
              : tr.kind === 'loading'
                ? 'Loading pass'
                : 'Passes could not be loaded'
        }
        detailLabel={(tr) => `Group metrics of ${runName(tr.kind === 'run' ? tr.row : tr.run)}`}
        childGroupLabel={(tr) => `Passes of ${runName(tr.kind === 'run' ? tr.row : tr.run)}`}
        cardChildColumns={cardMetric ? [`metric-${cardMetric}`, 'signals'] : ['signals']}
        renderExpanded={(tr) =>
          tr.kind === 'run' ? (
            <PassGroupStrip row={tr.row} remembered={choice} onMetric={chooseMetric} />
          ) : null
        }
        focusedKey={focusedKey}
        onFocusedKeyChange={(key) => {
          if (key === null) {
            setChildFocus(null);
            p.onFocusIndex(-1);
            return;
          }
          const isChild = String(key).includes('::');
          setChildFocus(isChild ? key : null);
          const id = runKeyOf(String(key));
          p.onFocusIndex(p.rows.findIndex((r) => r.run_id === id));
        }}
      >
        <DataTable.Toolbar columnsMenu {...p.toolbar} />
        <DataTable.Footer testId="status-bar" ariaLabel="Runs status" {...p.footer} />
      </DataTable>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete pass ${deleting?.n ?? ''}?`}
        description="The pass and its scores are removed from this run permanently. The run's means are recomputed."
        confirmLabel="Delete pass"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          const { run, n } = deleting;
          await del.mutateAsync({
            runId: run.run_id,
            passes: [n],
            expectedVersion: passQ(run)?.data?.pass_revision ?? run.pass_revision ?? 0,
          });
          p.onPassesDeleted?.(run.run_id);
          toast.show(`Pass ${n} deleted`, { tone: 'success' });
        }}
      />
    </div>
  );
}

function hasPassSelected(selected: Set<string>, runId: string): boolean {
  for (const ref of selected)
    if (ref.startsWith(runId + PASS_REF_SEP) && passRefBase(ref) === runId) return true;
  return false;
}
