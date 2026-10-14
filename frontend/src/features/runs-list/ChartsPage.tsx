/**
 * /projects/:slug/charts — one card per task, dataset tabs, model legend
 * (click toggles the model filter, double-click solos it: `?model=` updates),
 * Rows: Runs | Grouped, mini bars, sortable headers with aria-sort, group
 * Pass@K / Consistency / Reliability (batched models/stats), lazy per-card
 * history, remembered card height (brief 03 J7).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToggleButton } from 'react-aria-components';
import { useModelsStats, useOverview, usePoints, useRunsPage } from '@/api/dashboard';
import type { Combo, GroupStats, MetricType, RunRow } from '@/api/dashboardTypes';
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton, Tabs, TabPanel, Text } from '@/ui';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { formatClock } from '@/lib/format';
import { useDelayedPending } from '@/lib/pending';
import { Mono, ModelMark } from './cells';
import { ChartsTable } from './ChartsTable';
import { ColumnsMenu } from './ColumnsMenu';
import { RunsCtx, type RunsCtxValue } from './context';
import { buildColumns, GROUP_DISPLAY_COLUMNS, type ColumnSet } from './columns';
import {
  buildGroups,
  comboHasVersionData,
  effectiveGroupMode,
  groupMetricName,
  groupStatRule,
  prefersBar,
  sortRuns,
  toChartRun,
  TRACE_METRICS,
  visibleTraceMetrics,
  type ChartRun,
  type GroupMode,
  type SortDir,
} from './chartModel';
import { plainModelName } from './model';
import { RunsToolbar } from './RunsToolbar';
import { useKpiTopbar } from './kpiTopbar';
import { readVisibleColumns, writeVisibleColumns } from './selection';
import { contextForView, countActiveFilters, DEFAULT_VIEW, type RunsView } from './urlState';
import { useRefetchOnVisible, useRunsCadence } from './polling';
import { useRunsView } from './useRunsView';
import { viewToFilters } from './urlState';
import styles from './ChartsPage.module.css';

type RowMode = 'runs' | 'grouped';
type GroupAxis = 'model' | 'version' | 'version-model' | 'model-version';

function useInView(margin = '200px') {
  const ref = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return void setSeen(true); // eslint-disable-line react-hooks/set-state-in-effect
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), {
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return [ref, seen] as const;
}

const heightKey = (task: string, dataset: string) => `qym:chart-card-h:${JSON.stringify([task, dataset])}`;
function readHeight(task: string, dataset: string): number {
  try {
    return Number(sessionStorage.getItem(heightKey(task, dataset))) || 0;
  } catch {
    return 0;
  }
}

/** Per-card view choices (dataset tab, runs/grouped, group axis) survive a reload and Back from a run. */
interface CardPrefs {
  dataset?: string;
  mode?: RowMode;
  axis?: GroupAxis;
}
const prefsKey = (slug: string, task: string) => `qym:chart-card-prefs:${JSON.stringify([slug, task])}`;
function readPrefs(slug: string, task: string): CardPrefs {
  try {
    return (JSON.parse(sessionStorage.getItem(prefsKey(slug, task)) ?? '{}') as CardPrefs) ?? {};
  } catch {
    return {};
  }
}
function writePrefs(slug: string, task: string, prefs: CardPrefs): void {
  try {
    sessionStorage.setItem(prefsKey(slug, task), JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice just does not persist */
  }
}

export function ChartsPage() {
  const { slug } = useProjectContext();
  useDocumentTitle('Charts');
  const { view, setView } = useRunsView();
  const [visibleKeys, setVisibleKeys] = useState<Set<string> | null>(readVisibleColumns);
  const d = useRunsDataLite(slug, view, visibleKeys);
  const overview = d.overview;
  useKpiTopbar(overview?.kpis);
  const showSkeleton = useDelayedPending(d.overviewQ.isPending);
  const owners = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(overview?.owners ?? {}).map(([id, o]) => [id, o.display_name || o.email]),
      ),
    [overview?.owners],
  );
  const ctx = useMemo<RunsCtxValue>(
    () => ({
      slug,
      listContext: contextForView(view),
      metricTypes: overview?.metric_types ?? {},
      modelIndex: overview?.chart_data?.modelIndex ?? {},
      owners,
    }),
    [slug, view, overview, owners],
  );
  // Toggled-off models stay in the legend: facets.models ignores the model filter itself.
  const modelCounts = overview?.chart_data?.model_frequency ?? {};
  const models = [
    ...new Set([
      ...(overview?.chart_data?.models ?? []),
      ...(overview?.facets?.models ?? []),
      ...view.models.filter((m) => m !== '__none__'),
    ]),
  ];
  const shown = new Set(view.models.length ? view.models : models);
  const setModels = (keys: string[]) => setView({ models: keys.length === models.length ? [] : keys });
  const toggleModel = (key: string) => {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setModels(next.size === 0 ? [] : [...next]);
  };

  return (
    <RunsCtx.Provider value={ctx}>
      <div className={styles.screen} data-density="compact" data-testid="charts-page">
        <h1 className={styles.srOnly}>Charts</h1>
        <RunsToolbar
          mode="charts"
          view={view}
          facets={overview?.facets}
          owners={owners}
          onChange={setView}
          end={
            <ColumnsMenu
              groups={['metrics', 'system', 'trace', 'group']}
              all={d.columnSet.all}
              visible={d.columnSet.visible}
              onChange={(keys) => {
                setVisibleKeys(keys);
                writeVisibleColumns(keys);
              }}
            />
          }
        />
        <div className={styles.head}>
          <div>
            <Text variant="lg" as="h2">
              Metrics by task and dataset
            </Text>
            <Text variant="sm" tone="muted" as="p">
              {countActiveFilters(view) && overview ? `Filtered: ${overview.total_runs} runs · ` : ''}Average
              metric scores across all items in matching runs. Score bars use a 0-100% scale; numeric metrics
              and latency are relative to the best run in the card.
            </Text>
          </div>
          {models.length ? (
            <div
              className={styles.legend}
              role="group"
              aria-label="Models (click to toggle, double-click to show only one)"
            >
              {models.map((key) => (
                <ToggleButton
                  key={key}
                  className={styles.legendItem}
                  isSelected={shown.has(key)}
                  onChange={() => toggleModel(key)}
                  onDoubleClick={() => setModels([key])}
                >
                  <ModelMark modelKey={key} size="md" />
                  <span>{plainModelName(key)}</span>{' '}
                  <Mono className={styles.legendCount}>{modelCounts[key] ?? 0}</Mono>
                  <span className={styles.srOnly}> runs</span>
                </ToggleButton>
              ))}
              {view.models.length ? (
                <Button variant="ghost" onPress={() => setView({ models: [] })}>
                  Show all
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {d.overviewQ.isError && !overview ? (
          <ErrorState
            error={d.overviewQ.error}
            title="Could not load charts"
            onRetry={() => d.overviewQ.refetch()}
          />
        ) : !overview ? (
          showSkeleton ? (
            <Skeleton kind="chart" height={240} label="Loading charts" />
          ) : (
            <div style={{ minHeight: 240 }} aria-busy="true" />
          )
        ) : overview.chart_data.tasks.length === 0 ? (
          <EmptyState
            title={
              countActiveFilters(view) ? 'No runs match current filters' : 'No data available for charts'
            }
            body={
              countActiveFilters(view)
                ? 'Clear a filter or widen the time range.'
                : 'Run some evaluations first.'
            }
            action={
              countActiveFilters(view) ? (
                <Button variant="neutral" onPress={() => setView({ ...DEFAULT_VIEW, versioning: {} })}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          overview.chart_data.tasks.map((t) => (
            <TaskCard
              key={t.task}
              slug={slug}
              view={view}
              task={t.task}
              combos={t.datasets}
              metricTypes={overview.metric_types}
              visibleKeys={visibleKeys}
              revisionKey={overview.filtered_revision}
            />
          ))
        )}
        {d.overviewQ.dataUpdatedAt ? (
          <Text variant="sm" tone="muted" as="p" aria-live="polite">
            Last updated <Mono>{formatClock(new Date(d.overviewQ.dataUpdatedAt))}</Mono>
          </Text>
        ) : null}
      </div>
    </RunsCtx.Provider>
  );
}

/** Charts have no Duration column; the repeat-run group stats are toggleable instead. */
function withGroupColumns(set: ColumnSet, visibleKeys: Set<string> | null): ColumnSet {
  const all = [...set.all.filter((c) => c.id !== 'duration'), ...GROUP_DISPLAY_COLUMNS];
  const visible = [
    ...set.visible.filter((c) => c.id !== 'duration'),
    ...GROUP_DISPLAY_COLUMNS.filter((c) => visibleKeys === null || visibleKeys.has(c.visKey!)),
  ];
  return { all, ordered: set.ordered, visible };
}

/** Overview-only slice of useRunsData (charts do not page the runs list). */
function useRunsDataLite(slug: string, view: RunsView, visibleKeys: Set<string> | null) {
  const filters = useMemo(() => viewToFilters(view), [view]);
  // Same cadence as the runs list: 15 s while runs are live, 2 s while a stop settles, 60 s otherwise.
  const cadence = useRef<number | false>(60_000);
  const overviewQ = useOverview(slug, filters, { refetchInterval: () => cadence.current });
  const overview = overviewQ.data;
  const refetchOverview = overviewQ.refetch;
  // The overview does not say whether runs are live: ask the runs list for the live ones (RUNNING/PENDING).
  const liveQ = useRunsPage(
    {
      project_slug: slug,
      filters: { ...filters, statuses: ['RUNNING', 'PENDING'] },
      sort: 'activity-desc',
      limit: 8,
      offset: 0,
    },
    { refetchInterval: () => cadence.current },
  );
  const onAnnounce = useCallback(() => {
    void refetchOverview();
    void liveQ.refetch();
  }, [refetchOverview, liveQ]);
  const interval = useRunsCadence(
    { rows: liveQ.data?.rows ?? [], freshness: liveQ.data?.freshness },
    onAnnounce,
  );
  useEffect(() => {
    cadence.current = interval;
  }, [interval]);
  useRefetchOnVisible(onAnnounce);
  const trace = useMemo(
    () => new Set<string>(overview?.has_trace_stats ? TRACE_METRICS.map((t) => t.key) : []),
    [overview?.has_trace_stats],
  );
  const columnSet = useMemo(
    () => buildColumns(overview?.all_metrics ?? [], trace, visibleKeys),
    [overview?.all_metrics, trace, visibleKeys],
  );
  return { overviewQ, overview, columnSet: withGroupColumns(columnSet, visibleKeys), filters };
}

function TaskCard({
  slug,
  view,
  task,
  combos,
  metricTypes,
  visibleKeys,
  revisionKey,
}: {
  slug: string;
  view: RunsView;
  task: string;
  combos: Combo[];
  metricTypes: Record<string, MetricType>;
  visibleKeys: Set<string> | null;
  revisionKey: string;
}) {
  const [ref, seen] = useInView();
  const [saved] = useState(() => readPrefs(slug, task));
  const [dataset, setDataset] = useState(saved.dataset ?? combos[0]?.dataset ?? '');
  const active = combos.find((c) => c.dataset === dataset) ?? combos[0];
  const activeDataset = active?.dataset ?? '';
  const [mode, setMode] = useState<RowMode>(saved.mode === 'grouped' ? 'grouped' : 'runs');
  const [axis, setAxis] = useState<GroupAxis>(saved.axis ?? 'model');
  useEffect(() => {
    writePrefs(slug, task, { dataset: activeDataset, mode, axis });
  }, [slug, task, activeDataset, mode, axis]);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: '', dir: 'desc' });
  // Groups start collapsed; Expand all / Collapse all re-seed the table (epoch remounts it).
  const [openAll, setOpenAll] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const setAll = (open: boolean) => {
    setOpenAll(open);
    setEpoch((e) => e + 1);
  };
  const filters = useMemo(() => viewToFilters(view), [view]);
  const q = usePoints(slug, filters, 'time-desc', task, activeDataset, {
    enabled: seen && Boolean(activeDataset),
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = q;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, q.data?.pages.length]);
  const loaded = !q.isPending && !hasNextPage;
  const runs: ChartRun[] = useMemo(
    () => (q.data?.pages ?? []).flatMap((p) => p.rows).map((r: RunRow) => toChartRun(r)),
    [q.data],
  );
  // Re-fetch history when the overview revision of this combo moved.
  const comboRevision = active?.revision;
  const lastRev = useRef(comboRevision);
  const refetch = q.refetch;
  useEffect(() => {
    if (lastRev.current !== comboRevision) {
      lastRev.current = comboRevision;
      void refetch();
    }
  }, [comboRevision, refetch, revisionKey]);

  const cardRef = useRef<HTMLElement | null>(null);
  const [minH, setMinH] = useState(() => readHeight(task, activeDataset));
  useEffect(() => {
    if (!loaded || !cardRef.current) return;
    const h = Math.round(cardRef.current.getBoundingClientRect().height);
    try {
      sessionStorage.setItem(heightKey(task, activeDataset), String(h));
    } catch {
      /* private mode */
    }
  }, [loaded, task, activeDataset, runs.length, mode]);

  const comboMetrics = active?.metrics ?? [];
  const barMetrics = comboMetrics.filter(
    (m) => prefersBar(m, metricTypes[m]) && isMetricVisible(m, visibleKeys),
  );
  const plainMetrics = comboMetrics.filter(
    (m) => !prefersBar(m, metricTypes[m]) && isMetricVisible(m, visibleKeys),
  );
  const traces = visibleTraceMetrics(runs).filter((t) => (visibleKeys ? visibleKeys.has(t.key) : true));
  const showLatency = visibleKeys ? visibleKeys.has('latency') : true;
  const showMedian = visibleKeys ? visibleKeys.has('median-latency') : true;
  const traceKeys = traces.map((t) => t.key);
  const metricsForAgg = [...barMetrics, ...plainMetrics];
  const groupMode: GroupMode = mode === 'runs' ? 'run' : effectiveGroupMode(axis, comboHasVersionData(runs));
  const isGrouped = groupMode !== 'run';
  const statKinds = (['passAtK', 'consistency', 'reliability'] as const).filter(
    (k) => visibleKeys === null || visibleKeys.has(STAT_VIS_KEY[k]),
  );

  const sortKey = sort.key || barMetrics[0] || plainMetrics[0] || 'latency';
  const sortDir: SortDir = sort.key ? sort.dir : 'desc';
  const metricsKey = metricsForAgg.join('|');
  const traceKey = traceKeys.join('|');

  const metricName = groupMetricName(runs, comboMetrics, metricTypes);
  const rule = useMemo(() => groupStatRule(runs, metricName), [runs, metricName]);
  // Groups depend on stats for sorting; build twice (sort by stats once they are ready).
  const [statsMap, setStatsMap] = useState<Record<string, GroupStats>>({});
  const groupsRaw = isGrouped
    ? buildGroups(
        runs,
        groupMode,
        metricsKey ? metricsKey.split('|') : [],
        traceKey ? traceKey.split('|') : [],
        `${task}_${activeDataset}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        { key: sortKey, dir: sortDir },
        (g) => statsMap[g.id] ?? null,
      )
    : [];
  const flatGroups = groupsRaw.flatMap((g) => [g, ...(g.children ?? [])]);
  const statBody = (() => {
    if (!isGrouped || !rule || !loaded) return null;
    const groups = flatGroups
      .filter((g) => g.runs.length)
      .map((g) => ({ key: g.id, runs: [...new Set(g.runs.map((r) => r.run_id))] }));
    if (!groups.length || groups.length > 100 || groups.some((g) => g.runs.length > 2000)) return null;
    return { ...rule, groups };
  })();
  const statsQ = useModelsStats(statBody);
  const fetched = statsQ.data?.groups;
  useEffect(() => {
    if (fetched) setStatsMap(fetched); // eslint-disable-line react-hooks/set-state-in-effect
  }, [fetched]);

  const sortedRuns = sortRuns(runs, sortKey, sortDir);
  const maxOf = (f: (r: ChartRun) => number | null | undefined) => Math.max(0, ...runs.map((r) => f(r) ?? 0));
  const scaleMax = Object.fromEntries(
    metricsForAgg.map((m) => [m, metricTypes[m] === 'numeric' ? maxOf((r) => r.metric_averages[m]) : 1]),
  );
  const maxLatency = maxOf((r) => r.latency);
  const maxMedian = maxOf((r) => r.median_latency);
  const traceMax = Object.fromEntries(
    traces.map((t) => [
      t.key,
      t.key === 'tool_success_rate' ? 1 : maxOf((r) => (r.trace_stats?.[t.key] as number | undefined) ?? 0),
    ]),
  );

  const allModels = new Set(combos.flatMap((c) => Object.keys(c.models))).size;
  const totalRuns = combos.reduce((n, c) => n + c.totalRuns, 0);

  const sortBy = (key: string, dir: SortDir) => setSort({ key, dir });

  return (
    <section
      ref={(el) => {
        ref.current = el;
        cardRef.current = el;
      }}
      className={styles.card}
      aria-labelledby={`card-${task}`}
      style={!loaded && minH ? { minHeight: minH } : undefined}
      data-testid={`chart-card-${task}`}
    >
      <header className={styles.cardHead}>
        <Text variant="md" as="h3" id={`card-${task}`} className={styles.cardTitle}>
          {task}
        </Text>
        <Text variant="sm" tone="muted" as="span" mono>
          {totalRuns} runs · {allModels} models · {comboMetrics.length} metrics
        </Text>
      </header>
      <Tabs
        label={`${task} datasets`}
        variant="dense"
        items={combos.map((c) => ({ id: c.dataset, label: c.dataset, count: c.totalRuns }))}
        selected={activeDataset}
        onSelect={(id) => {
          setDataset(id);
          setMinH(readHeight(task, id));
          setAll(false);
          setSort({ key: '', dir: 'desc' });
        }}
      >
        <TabPanel id={activeDataset}>
          <div className={styles.toolbar}>
            <Text variant="sm" tone="muted" as="span" className={styles.toolbarLabel}>
              Rows
            </Text>
            <SegmentedControl<RowMode>
              label={`${task} rows`}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'runs', label: 'Runs' },
                { value: 'grouped', label: 'Grouped' },
              ]}
            />
            {mode === 'grouped' ? (
              <>
                <Text variant="sm" tone="muted" as="span" className={styles.toolbarLabel}>
                  Group
                </Text>
                <SegmentedControl<'model' | 'version'>
                  label={`${task} group by`}
                  value={axis === 'model' || axis === 'model-version' ? 'model' : 'version'}
                  onChange={(v) => setAxis(v)}
                  options={[
                    { value: 'model', label: 'Model' },
                    { value: 'version', label: 'Version', disabled: !comboHasVersionData(runs) },
                  ]}
                />
                <Text variant="sm" tone="muted" as="span" className={styles.toolbarLabel}>
                  Then
                </Text>
                <SegmentedControl<'none' | 'model' | 'version'>
                  label={`${task} then by`}
                  value={axis === 'version-model' ? 'model' : axis === 'model-version' ? 'version' : 'none'}
                  onChange={(v) =>
                    setAxis(
                      v === 'none'
                        ? axis === 'version-model' || axis === 'version'
                          ? 'version'
                          : 'model'
                        : axis === 'version' || axis === 'version-model'
                          ? 'version-model'
                          : 'model-version',
                    )
                  }
                  options={[
                    { value: 'none', label: 'None' },
                    {
                      value: 'model',
                      label: 'Model',
                      disabled: axis === 'model' || axis === 'model-version',
                    },
                    {
                      value: 'version',
                      label: 'Version',
                      disabled: axis === 'version' || axis === 'version-model' || !comboHasVersionData(runs),
                    },
                  ]}
                />
                <Button variant="ghost" onPress={() => setAll(!openAll)}>
                  {openAll ? 'Collapse all' : 'Expand all'}
                </Button>
              </>
            ) : null}
          </div>
          <div>
            {q.isError ? (
              <ErrorState
                compact
                error={q.error}
                title={`Could not load ${activeDataset} runs`}
                onRetry={() => q.refetch()}
              />
            ) : !seen || !loaded ? (
              <div
                style={{ minHeight: minH ? minH - 140 : 120, padding: 'var(--space-md)' }}
                aria-busy="true"
              >
                <Skeleton kind="lines" rows={5} label={`Loading ${activeDataset} runs`} />
              </div>
            ) : (
              <ChartsTable
                key={`${epoch}:${groupMode}`}
                slug={slug}
                task={task}
                dataset={activeDataset}
                runs={sortedRuns}
                groups={groupsRaw}
                groupMode={groupMode}
                defaultOpen={openAll}
                barMetrics={barMetrics}
                plainMetrics={plainMetrics}
                traces={traces}
                showLatency={showLatency}
                showMedian={showMedian}
                statKinds={statKinds}
                metricTypes={metricTypes}
                scaleMax={scaleMax}
                maxLatency={maxLatency}
                maxMedian={maxMedian}
                traceMax={traceMax}
                sort={{ key: sortKey, dir: sortDir }}
                onSort={sortBy}
                statsMap={statsMap}
                statsBusy={statsQ.isPending || statsQ.isFetching}
                statsAvailable={Boolean(rule)}
              />
            )}
          </div>
        </TabPanel>
      </Tabs>
    </section>
  );
}

const STAT_VIS_KEY = {
  passAtK: 'group_pass_at_k',
  consistency: 'group_consistency',
  reliability: 'group_reliability',
} as const;
function isMetricVisible(metric: string, visible: Set<string> | null): boolean {
  return visible === null || visible.has(metric);
}
