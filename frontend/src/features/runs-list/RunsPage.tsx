/** /projects/:slug — the runs list (brief 03 J1–J6). Variant A "dense table" per UX_DECISION. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState, StaleBanner, Text, useToast } from '@/ui';
import { useAnalyzingRuns } from '@/api/analysis';
import { readPersisted } from '@/ui/DataTable/model';
import { useAuth, useDocumentTitle, useMediaQuery, useProjectContext } from '@/features/shell';
import { ROUTES, runPath, projectPath } from '@/app/routes';
import { useDelayedPending } from '@/lib/pending';
import { KEYS, readLocal, writeLocal } from '@/lib/storage';
import { runHref } from '@/lib/runs-order';
import { RunDialogs, type DialogState } from './RunDialogs';
import { pruneExpanded, readExpanded, writeExpanded } from './passes/expandedStorage';
import { RunsCtx, type RunsCtxValue } from './context';
import { RunsTable } from './RunsTable';
import { useRunsToolbarParts } from './RunsToolbar';
import { SelectionBar } from './SelectionBar';
import { ShortcutsDialog } from './ShortcutsDialog';
import { FooterTrailing } from './StatusBar';
import { useRunsData } from './useRunsData';
import { useRunsKeyboard, type RunsKeyboardHandlers } from './useRunsKeyboard';
import { useRunsView } from './useRunsView';
import { useTableScrollRestoration } from './useTableScrollRestoration';
import {
  cohortRefsConflict,
  cohortUnitCount,
  handoffCohorts,
  handoffCompare,
  isPassRef,
  passRefBase,
  readVisibleColumns,
  rememberRunFile,
  useRunsSelection,
} from './selection';
import { prefetchRunChunkWhenIdle } from '@/app/prefetch';
import {
  contextForView,
  countActiveFilters,
  filterSummary,
  DEFAULT_VIEW,
  PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  parseSort,
} from './urlState';
import { defaultDirection, modelOptionLabel, sortString } from './urlState';
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
  // Visibility lives in the table's saved layout (per user); the page mirrors it for the sort fallback.
  const legacyVisible = useMemo(() => readVisibleColumns(), []);
  const layoutScope = me.id;
  const [hiddenIds, setHiddenIds] = useState<Set<string> | null>(() => {
    const saved = readPersisted('runs.v2', layoutScope).hidden;
    return saved ? new Set(saved) : null;
  });
  const [selectMode, setSelectMode] = useState(
    () => selection.selected.size > 0 || selection.cohortA.length > 0,
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(slug));
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pageSize, setPageSizeState] = useState<number>(() => {
    const n = Number(readLocal(KEYS.runsPageSize));
    return PAGE_SIZE_OPTIONS.includes(n) ? n : PAGE_SIZE;
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const pending = useRef<'first' | 'last' | null>(null);

  const pinnedIds = useMemo(
    () => [...new Set([...selection.selected, ...selection.cohortA].map(passRefBase))],
    [selection.selected, selection.cohortA],
  );
  const d = useRunsData(slug, view, legacyVisible, pinnedIds, pageSize, hiddenIds);
  const { rows, columnSet } = d;
  // Open pass groups are kept for the tab, so Back from a pass returns to the same groups.
  useEffect(() => writeExpanded(slug, pruneExpanded(expanded, rows)), [slug, expanded, rows]);
  const analyzingRuns = useAnalyzingRuns(rows.map((r) => r.run_id));

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
    if (!d.data || !pinnedReady || d.runsQ.isFetching || d.runsQ.isError) return;
    reconcile([...d.pinnedRows, ...rows], new Set([...d.pinnedRows, ...rows].map((r) => r.run_id)));
  }, [d.data, pinnedReady, d.runsQ.isFetching, d.runsQ.isError, d.pinnedRows, rows, reconcile]);

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
      analyzing: analyzingRuns.data,
    }),
    [slug, view, d.overview, owners, analyzingRuns.data],
  );

  const perm = useMemo(
    () => ({ readOnly, canManage, isAdmin, meId: me.id }),
    [readOnly, canManage, isAdmin, me.id],
  );
  const showSkeleton = useDelayedPending(d.runsQ.isPending && !d.runsQ.isError);
  const stale = d.runsQ.isError && Boolean(d.data);
  const totalPages = Math.max(1, Math.ceil(d.total / pageSize));
  const page = Math.min(view.page, totalPages);
  useEffect(() => {
    // The total shrank under the current page (filters, deletes): clamp.
    if (d.data && !d.runsQ.isError && view.page > totalPages) setPage(totalPages);
  }, [d.data, d.runsQ.isError, view.page, totalPages, setPage]);

  useTableScrollRestoration(pageRef, Boolean(d.data) && rows.length > 0);
  const sortSpec = parseSort(d.sort);
  // Once the list is on screen and idle, the run page's chunk is fetched (not its data).
  const haveRows = rows.length > 0;
  useEffect(() => {
    if (haveRows) prefetchRunChunkWhenIdle();
  }, [haveRows]);
  const setPageSize = (size: number) => {
    writeLocal(KEYS.runsPageSize, String(size));
    setPageSizeState(size);
    setPage(1);
  };
  const onSort = (field: string | null, forced?: 'asc' | 'desc') =>
    setView((v) => {
      if (field === null) return { ...v, sort: DEFAULT_VIEW.sort };
      const cur = parseSort(v.sort);
      const direction =
        forced ??
        (cur.field === field ? (cur.direction === 'asc' ? 'desc' : 'asc') : defaultDirection(field));
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
    navigate(`${projectPath(slug, 'compare')}?${qs}`);
  }, [refs, samplesOf, toast, navigate, slug]);
  const cohort = useCallback(() => {
    if (!selection.cohortA.length) {
      if (!refs.length) return;
      selection.lockCohortA();
      toast.show(`Cohort A locked. Pick ${cohortUnitCount(refs, samplesOf)} runs for cohort B.`, {
        tone: 'info',
      });
      return;
    }
    const a = selection.cohortA;
    const ua = cohortUnitCount(a, samplesOf);
    const ub = cohortUnitCount(refs, samplesOf);
    if (ua !== ub)
      return toast.show(
        `Cohort A holds ${ua} run${ua === 1 ? '' : 's'}; B holds ${ub}. Balance the two sides first.`,
        { tone: 'error' },
      );
    if (refs.some((r) => a.some((l) => cohortRefsConflict(l, r))))
      return toast.show('One or more runs are already in Cohort A. Pick different runs for B.', {
        tone: 'error',
      });
    const qs = handoffCohorts(a, refs, samplesOf, nameOf);
    navigate(`${projectPath(slug, 'compare')}?${qs}`);
  }, [selection, refs, samplesOf, nameOf, toast, navigate, slug]);

  const selectedRows = (): typeof rows =>
    [...new Set(refs.map(passRefBase))]
      .map((id) => known.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const onAction = (id: string, row: (typeof rows)[number]) => {
    if (id === 'analyze') navigate(`${runPath(slug, row.run_id)}/analyzer`);
    else if (id === 'delete')
      setDialog({
        kind: 'delete',
        refs: [row.run_id],
        revisions: {},
        names: [row.external_run_id || row.run_name],
      });
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
        // a page change is in flight: the focused row belongs to the page being left
        if (!r || pending.current) return;
        setSelectMode(true);
        selection.toggle(r.run_id);
      },
      compare: () =>
        selection.cohortA.length ? cohort() : selection.selected.size >= 2 ? compare() : undefined,
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
      cohort,
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
  const picked = selectedRows();
  const mayManage = (r: (typeof rows)[number]) => isAdmin || canManage || r.owner?.id === me.id;
  // Delete: every pick must be ours to delete; a pass only while its run is settled, and never all passes of a run.
  const canDeleteAll =
    picked.every(mayManage) &&
    refs.every((ref) => {
      if (!isPassRef(ref)) return true;
      const r = known.get(passRefBase(ref));
      return !r || !['RUNNING', 'PENDING', 'SUBMITTED', 'APPROVED'].includes(r.status);
    }) &&
    picked.every((r) => {
      const n = refs.filter((x) => isPassRef(x) && passRefBase(x) === r.run_id).length;
      return n === 0 || n < r.samples;
    });
  const canSubmitAll =
    picked.length > 0 &&
    picked.every(
      (r) =>
        (isAdmin || canManage || r.owner?.id === me.id) &&
        ['COMPLETED', 'FAILED', 'REJECTED'].includes(r.status),
    );
  const cohortOverlap = refs.some((r) => selection.cohortA.some((l) => cohortRefsConflict(l, r)));

  // C069: a search that finds nothing offers the model filter it may have meant ('gpt-4.1' is a model, not a run name)
  const q = view.q.trim().toLowerCase();
  const modelHint =
    q && !view.models.length
      ? (d.overview?.all_models ?? []).find((m) => modelOptionLabel(m).toLowerCase().includes(q))
      : undefined;
  const empty = () =>
    d.projectTotal === 0 && !filtered ? (
      <EmptyState
        title={d.data?.freshness.unpublished_runs ? 'Run history is preparing' : 'No evaluation runs found'}
        guide={d.data?.freshness.unpublished_runs ? undefined : '/docs/get-started/first-run'}
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
        title={view.q ? `No run or dataset name contains "${view.q}"` : 'No runs match current filters'}
        body={
          d.data?.freshness.unpublished_runs
            ? 'Run history is preparing. Available runs will appear automatically.'
            : view.q
              ? undefined
              : 'Clear a filter or widen the time range.'
        }
        action={
          filtered ? (
            <span className={styles.emptyActions}>
              <Button
                variant="neutral"
                onPress={() => setView({ ...DEFAULT_VIEW, versioning: {}, sort: view.sort })}
              >
                Clear filters
              </Button>
              {modelHint ? (
                <Button variant="primary" onPress={() => setView({ q: '', models: [modelHint] })}>
                  Filter by model {modelOptionLabel(modelHint)}
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
      />
    );
  const emptyNode = empty();
  const toolbarParts = useRunsToolbarParts({
    view,
    facets: d.overview?.facets,
    owners,
    onChange: setView,
    searchRef,
  });
  const loadPending = d.runsQ.isPending || (!d.data && !d.runsQ.isError);
  // C224: card mode (< 640 px) has no rows to space or keys to press, so no Density menu and no Shortcuts button
  const cards = useMediaQuery('(max-width: 639px)');
  const loadError = d.runsQ.isError && !d.data ? d.runsQ.error : undefined;
  const table = (
    <RunsTable
      slug={slug}
      rows={rows}
      columns={columnSet.ordered}
      defaultHidden={d.defaultHidden}
      storageScope={layoutScope}
      onHiddenChange={setHiddenIds}
      sort={sortSpec}
      onSort={onSort}
      selectMode={selectMode}
      selected={selection.selected}
      onToggleSelect={selection.toggle}
      onSelectPage={selection.setMany}
      onNotePassRevision={selection.notePassRevision}
      onPassesDeleted={selection.dropPassPicks}
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
      onSignalDetails={(row, metric) => setDialog({ kind: 'errors', row, metric })}
      loading={loadPending && !loadError ? (showSkeleton ? true : 'quiet') : false}
      error={loadError}
      onRetry={() => d.runsQ.refetch()}
      dimmed={stale || d.runsQ.isPlaceholderData}
      emptyState={emptyNode}
      className={styles.table}
      toolbar={{
        search: toolbarParts.search,
        filters: toolbarParts.filters,
        rows: toolbarParts.rows,
        densityMenu: cards ? false : undefined,
        // in select mode Done selecting sits with the selection actions (round 10), so the toggle shows only to enter it
        trailing: selectMode ? null : (
          <Button variant="neutral" onPress={() => setSelectMode(true)} aria-pressed={false}>
            Select
          </Button>
        ),
      }}
      footer={{
        // C224: the pager already says '1–50 of 271 runs', so the summary shows only for a filter or a search
        summary:
          !d.data || filtered || stale ? (
            <span aria-live="polite">
              {d.data ? (filtered ? sentence : '') : 'Loading runs…'}
              {stale ? `${filtered ? ' · ' : ''}showing runs from an earlier refresh` : ''}
            </span>
          ) : null,
        pagination: {
          total: d.total,
          page,
          pageSize,
          noun: 'runs',
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onPageSizeChange: setPageSize,
          onPageChange: setPage,
        },
        trailing: (
          <FooterTrailing
            updatedAt={d.updatedAt}
            freshness={d.data?.freshness}
            failed={stale}
            onHelp={cards ? undefined : () => setHelpOpen(true)}
          />
        ),
      }}
      bulk={
        <SelectionBar
          count={cohortUnitCount(refs, samplesOf)}
          cohortA={selection.cohortA}
          cohortAUnits={cohortUnitCount(selection.cohortA, samplesOf)}
          cohortOverlap={cohortOverlap}
          readOnly={readOnly}
          canSubmit={canSubmitAll}
          canDelete={canDeleteAll}
          mixedTasks={new Set(picked.map((r) => r.task_name)).size > 1}
          onCompare={compare}
          onCohort={cohort}
          onSubmit={() => setDialog({ kind: 'submit', rows: selectedRows() })}
          onDelete={() =>
            setDialog({
              kind: 'delete',
              refs,
              revisions: Object.fromEntries(picked.map((r) => [r.run_id, r.pass_revision ?? 0])),
              names: refs.map(
                (r) =>
                  nameOf(passRefBase(r)) + (r.includes('::pass') ? ` (pass ${r.split('::pass')[1]})` : ''),
              ),
            })
          }
          onClear={() => selection.clearSelected()}
          onCancelCohort={() => selection.clear()}
          onDone={clearSelection}
        />
      }
    />
  );

  return (
    <RunsCtx.Provider value={ctx}>
      <div className={styles.runs} data-testid="runs-page" ref={pageRef}>
        <Text variant="title" as="h1" className={styles.srOnly}>
          Runs
        </Text>
        {stale && d.updatedAt ? (
          <StaleBanner
            since={d.updatedAt}
            filtersApplied={!d.viewNotApplied}
            onRetry={() => d.runsQ.refetch()}
          />
        ) : null}
        {table}
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
