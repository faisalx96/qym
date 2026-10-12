/** /projects/:slug — the runs list (brief 03 J1–J6). Variant A "dense table" per UX_DECISION. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState, ErrorState, Skeleton, StaleBanner, Text, useToast } from '@/ui';
import { useAuth, useDocumentTitle, useProjectContext } from '@/features/shell';
import { ROUTES, runPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import { runHref } from '@/lib/runs-order';
import { ColumnsMenu } from './ColumnsMenu';
import { RunDialogs, type DialogState } from './RunDialogs';
import { RunsCtx, type RunsCtxValue } from './context';
import { RunsTable } from './RunsTable';
import { RunsToolbar } from './RunsToolbar';
import { SelectionBar } from './SelectionBar';
import { ShortcutsDialog } from './ShortcutsDialog';
import { StatusBar } from './StatusBar';
import { useKpiTopbar } from './kpiTopbar';
import { useRunsData } from './useRunsData';
import { useRunsKeyboard, type RunsKeyboardHandlers } from './useRunsKeyboard';
import { useRunsView } from './useRunsView';
import {
  cohortRefsConflict,
  cohortUnitCount,
  handoffCohorts,
  handoffCompare,
  passRefBase,
  readVisibleColumns,
  rememberRunFile,
  useRunsSelection,
  writeVisibleColumns,
} from './selection';
import {
  contextForView,
  countActiveFilters,
  filterSummary,
  DEFAULT_VIEW,
  PAGE_SIZE,
  parseSort,
} from './urlState';
import { defaultDirection, sortString } from './urlState';
import { datasetLabel } from './FiltersPopover';
import styles from './RunsPage.module.css';

export function RunsPage() {
  const { slug, project, readOnly, canManage, isAdmin } = useProjectContext();
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  useDocumentTitle('Runs');
  const { view, setView, setPage } = useRunsView();
  const selection = useRunsSelection(slug);
  const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(readVisibleColumns);
  const [selectMode, setSelectMode] = useState(
    () => selection.selected.size > 0 || selection.cohortA.length > 0,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = useRef<'first' | 'last' | null>(null);

  const pinnedIds = useMemo(
    () => [...new Set([...selection.selected, ...selection.cohortA].map(passRefBase))],
    [selection.selected, selection.cohortA],
  );
  const d = useRunsData(slug, view, visibleKeys, pinnedIds);
  const { rows, columnSet } = d;
  useKpiTopbar(d.overview?.kpis);

  const known = useMemo(
    () => new Map([...d.pinnedRows, ...rows].map((r) => [r.run_id, r])),
    [d.pinnedRows, rows],
  );
  const samplesOf = useCallback((id: string) => known.get(id)?.samples ?? 1, [known]);
  const nameOf = useCallback(
    (id: string) => known.get(id)?.external_run_id || known.get(id)?.run_name || id.slice(0, 8),
    [known],
  );

  // Drop selected runs that no longer exist and pass picks whose passes changed.
  const reconcile = selection.reconcile;
  const pinnedReady = d.pinnedReady;
  useEffect(() => {
    if (!d.data || !pinnedReady || d.runsQ.isFetching) return;
    reconcile([...d.pinnedRows, ...rows], new Set([...d.pinnedRows, ...rows].map((r) => r.run_id)));
  }, [d.data, pinnedReady, d.runsQ.isFetching, d.pinnedRows, rows, reconcile]);

  // Focus resets on a sort/page change (declared first so a pending keyboard landing wins).
  useEffect(() => {
    if (!pending.current) setFocusedIndex(-1);
  }, [d.sort, view.page]);

  // Keyboard focus moved across a page edge: land on the first/last row once the page loads.
  useEffect(() => {
    if (!rows.length || !pending.current) return;
    setFocusedIndex(pending.current === 'first' ? 0 : rows.length - 1);
    pending.current = null;
  }, [rows]);

  const owners = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(d.overview?.owners ?? {}).map(([id, o]) => [id, o.display_name || o.email]),
      ),
    [d.overview?.owners],
  );
  const ctx = useMemo<RunsCtxValue>(
    () => ({
      slug,
      listContext: contextForView(view),
      metricTypes: d.overview?.metric_types ?? {},
      modelIndex: d.overview?.chart_data?.modelIndex ?? {},
      owners,
    }),
    [slug, view, d.overview, owners],
  );

  const perm = useMemo(
    () => ({ readOnly, canManage, isAdmin, meId: me.id }),
    [readOnly, canManage, isAdmin, me.id],
  );
  const showSkeleton = useDelayedPending(d.runsQ.isPending && !d.runsQ.isError);
  const stale = d.runsQ.isError && Boolean(d.data);
  const totalPages = Math.max(1, Math.ceil(d.total / PAGE_SIZE));
  const page = Math.min(view.page, totalPages);
  useEffect(() => {
    // The total shrank under the current page (filters, deletes): clamp.
    if (d.data && view.page > totalPages) setPage(totalPages);
  }, [d.data, view.page, totalPages, setPage]);

  const sortSpec = parseSort(d.sort);
  const onSort = (field: string) =>
    setView((v) => {
      const cur = parseSort(v.sort);
      const direction =
        cur.field === field ? (cur.direction === 'asc' ? 'desc' : 'asc') : defaultDirection(field);
      return { ...v, sort: sortString({ field, direction }) };
    });

  const openRun = useCallback(
    (row: { run_id: string }) => {
      rememberRunFile(row.run_id);
      navigate(runHref(runPath(slug, row.run_id), contextForView(view)));
    },
    [navigate, slug, view],
  );

  const clearSelection = () => {
    selection.clear();
    setSelectMode(false);
  };
  const refs = useMemo(() => [...selection.selected], [selection.selected]);
  const compare = useCallback(() => {
    const units = cohortUnitCount(refs, samplesOf);
    if (units < 2) return toast.show('Select at least 2 runs to compare', { tone: 'error' });
    const qs = handoffCompare(refs, samplesOf);
    navigate(`${ROUTES.compare}?${qs}`);
  }, [refs, samplesOf, toast, navigate]);
  const cohort = () => {
    if (!selection.cohortA.length) {
      if (!refs.length) return;
      selection.lockCohortA();
      toast.show(`Cohort A locked. Pick ${cohortUnitCount(refs, samplesOf)} executions for cohort B.`, {
        tone: 'info',
      });
      return;
    }
    const a = selection.cohortA;
    const ua = cohortUnitCount(a, samplesOf);
    const ub = cohortUnitCount(refs, samplesOf);
    if (ua !== ub)
      return toast.show(
        `Cohort A holds ${ua} execution${ua === 1 ? '' : 's'}; B holds ${ub}. Balance the two sides first.`,
        { tone: 'error' },
      );
    if (refs.some((r) => a.some((l) => cohortRefsConflict(l, r))))
      return toast.show('One or more runs are already in Cohort A. Pick different runs for B.', {
        tone: 'error',
      });
    const qs = handoffCohorts(a, refs, samplesOf, nameOf);
    navigate(`${ROUTES.compare}?${qs}`);
  };

  const selectedRows = (): typeof rows =>
    [...new Set(refs.map(passRefBase))]
      .map((id) => known.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const onAction = (id: string, row: (typeof rows)[number]) => {
    if (id === 'delete')
      setDialog({ kind: 'delete', refs: [row.run_id], names: [row.external_run_id || row.run_name] });
    else if (id === 'submit') setDialog({ kind: 'submit', rows: [row] });
    else if (id === 'transfer') setDialog({ kind: 'transfer', row });
    else if (id === 'approve' || id === 'reject' || id === 'unapprove' || id === 'unreject')
      setDialog({ kind: 'workflow', action: id, row });
  };

  const handlers: RunsKeyboardHandlers = useMemo(
    () => ({
      moveFocus: (delta) => {
        const next = focusedIndex + delta;
        if (next >= rows.length && page < totalPages) {
          pending.current = 'first';
          setPage(page + 1);
        } else if (next < 0 && page > 1 && focusedIndex >= 0) {
          pending.current = 'last';
          setPage(page - 1);
        } else setFocusedIndex(Math.max(0, Math.min(rows.length - 1, next)));
      },
      focusFirst: () => {
        if (page !== 1) {
          pending.current = 'first';
          setPage(1);
        } else setFocusedIndex(0);
      },
      focusLast: () => {
        if (page !== totalPages) {
          pending.current = 'last';
          setPage(totalPages);
        } else setFocusedIndex(rows.length - 1);
      },
      openFocused: () => {
        const r = rows[focusedIndex];
        if (r && document.activeElement?.tagName !== 'A' && document.activeElement?.tagName !== 'BUTTON')
          openRun(r);
      },
      toggleFocused: () => {
        const r = rows[focusedIndex];
        if (!r) return;
        setSelectMode(true);
        selection.toggle(r.run_id);
      },
      compare: () => (selection.selected.size ? compare() : undefined),
      focusSearch: () => searchRef.current?.focus(),
      openHelp: () => setHelpOpen(true),
      setRange: (range) => setView({ range, from: '', to: '' }),
      escape: () => {
        if (selection.selected.size || selection.cohortA.length) selection.clear();
        else if (selectMode) setSelectMode(false);
        else setFocusedIndex(-1);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection.toggle is stable; the selection sets are listed explicitly
    [
      rows,
      focusedIndex,
      page,
      totalPages,
      selectMode,
      selection.selected,
      selection.cohortA,
      compare,
      openRun,
      setPage,
      setView,
    ],
  );
  useRunsKeyboard(handlers, !dialog);

  const filtered = countActiveFilters(view) > 0;
  const sentence = filterSummary(
    view,
    { total: d.projectTotal, filtered: d.total },
    { owner: (id) => owners[id] ?? id, dataset: datasetLabel },
  );
  const canDeleteAny = isAdmin || canManage || selectedRows().every((r) => r.owner?.id === me.id);

  let body;
  if (d.runsQ.isError && !d.data) {
    body = (
      <div className={styles.centered}>
        <ErrorState error={d.runsQ.error} title="Could not load runs" onRetry={() => d.runsQ.refetch()} />
      </div>
    );
  } else if (d.runsQ.isPending || (!d.data && !d.runsQ.isError)) {
    body = showSkeleton ? (
      <Skeleton kind="table" rows={12} label="Loading runs" />
    ) : (
      <div style={{ minHeight: 240 }} aria-busy="true" />
    );
  } else {
    const empty =
      d.projectTotal === 0 && !filtered ? (
        <EmptyState
          title={d.data?.freshness.unpublished_runs ? 'Run history is preparing' : 'No evaluation runs found'}
          body={
            d.data?.freshness.unpublished_runs ? (
              'Available runs will appear automatically.'
            ) : (
              <>
                Push a run with the SDK, or read{' '}
                <Link to={`${ROUTES.docs}#get-started/first-run`} className={styles.inlineLink}>
                  how to log your first run
                </Link>
                .
              </>
            )
          }
        />
      ) : (
        <EmptyState
          compact
          title="No runs match current filters"
          body={
            d.data?.freshness.unpublished_runs
              ? 'Run history is preparing. Available runs will appear automatically.'
              : 'Clear a filter or widen the time range.'
          }
          action={
            filtered ? (
              <Button
                variant="neutral"
                onPress={() => setView({ ...DEFAULT_VIEW, versioning: {}, sort: view.sort })}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      );
    body = (
      <RunsTable
        slug={slug}
        rows={rows}
        columns={columnSet.visible}
        sort={sortSpec}
        onSort={onSort}
        selectMode={selectMode}
        selected={selection.selected}
        onToggleSelect={selection.toggle}
        onSelectPage={selection.setMany}
        expanded={expanded}
        onToggleExpand={(id) =>
          setExpanded((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        focusedIndex={focusedIndex}
        onFocusIndex={setFocusedIndex}
        onOpen={openRun}
        perm={perm}
        onAction={onAction}
        onSignalDetails={(row) => setDialog({ kind: 'errors', row })}
        dimmed={stale || d.runsQ.isPlaceholderData}
        emptyState={empty}
        className={styles.table}
      />
    );
  }

  return (
    <RunsCtx.Provider value={ctx}>
      <div className={styles.runs} data-testid="runs-page">
        <h1 className={styles.srOnly}>Runs</h1>
        <RunsToolbar
          mode="runs"
          view={view}
          facets={d.overview?.facets}
          owners={owners}
          onChange={setView}
          searchRef={searchRef}
          end={
            <>
              <ColumnsMenu
                all={columnSet.all}
                visible={columnSet.visible}
                onChange={(keys) => {
                  setVisibleKeys(keys);
                  writeVisibleColumns(keys);
                }}
              />
              <Button
                variant={selectMode ? 'accent' : 'neutral'}
                onPress={() => (selectMode ? clearSelection() : setSelectMode(true))}
                aria-pressed={selectMode}
              >
                {selectMode ? 'Done selecting' : 'Select'}
              </Button>
            </>
          }
        />
        {stale && d.updatedAt ? (
          <StaleBanner since={d.updatedAt} filtersApplied={false} onRetry={() => d.runsQ.refetch()} />
        ) : null}
        {body}
        <StatusBar
          left={
            selectMode ? (
              <SelectionBar
                count={cohortUnitCount(refs, samplesOf)}
                cohortA={selection.cohortA}
                readOnly={readOnly}
                canDelete={canDeleteAny}
                onCompare={compare}
                onCohort={cohort}
                onSubmit={() => setDialog({ kind: 'submit', rows: selectedRows() })}
                onDelete={() =>
                  setDialog({
                    kind: 'delete',
                    refs,
                    names: refs.map(
                      (r) =>
                        nameOf(passRefBase(r)) +
                        (r.includes('::pass') ? ` (pass ${r.split('::pass')[1]})` : ''),
                    ),
                  })
                }
                onClear={clearSelection}
              />
            ) : (
              <Text variant="sm" tone="muted" as="span" aria-live="polite">
                {d.data ? sentence : 'Loading runs…'}
                {stale ? ' · showing runs from an earlier refresh' : ''}
              </Text>
            )
          }
          total={d.total}
          page={page}
          onPage={setPage}
          updatedAt={d.updatedAt}
          freshness={d.data?.freshness}
          failed={stale}
          onHelp={() => setHelpOpen(true)}
        />
        <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <RunDialogs
          slug={slug}
          projectId={project.id}
          state={dialog}
          onClose={() => setDialog(null)}
          onDeleted={clearSelection}
          onSubmitted={() => selection.clearSelected()}
        />
      </div>
    </RunsCtx.Provider>
  );
}
