/**
 * /projects/:slug/models (brief 06 §2.10): compare models on one task and dataset over their last K
 * runs. Self-contained filter row (time range, origin, task, dataset in the URL), summary path only.
 */
import { useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useOverview } from '@/api/dashboard';
import {
  traceAverages,
  useModelCandidates,
  useModelStats,
  type DashboardFilters,
  type ModelRun,
} from '@/api/dashboardModels';
import {
  activeChips,
  datasetLabel,
  DEFAULT_VIEW,
  filterKey,
  filterSummary,
  FiltersPopover,
  useKpiTopbar,
  useRunsView,
  viewToFilters,
  type RunsView,
} from '@/features/runs-list';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import { formatPercent, metricDirection, type MetricDirection } from '@/lib/metrics';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  MultiSelect,
  NumberField,
  PageHeader,
  ScoreValue,
  Select,
  Skeleton,
  Slider,
} from '@/ui';
import { ModelCard } from './ModelCard';
import styles from './Models.module.css';
import {
  buildStatGroups,
  clampK,
  defaultMetric,
  defaultPassThreshold,
  DEFAULT_K,
  metricKind,
  orderMetrics,
  parseModelKey,
  rankModels,
  scopedOptions,
  selectedRunIds,
  chosenOption,
  withoutTaskAndDataset,
  showsThreshold,
  statTiles,
} from './modelsLogic';
import { RunSelectionDialog } from './RunSelectionDialog';

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

export function ModelsPage() {
  const { project, slug } = useProjectContext();
  useDocumentTitle(`${project.name} · Models`);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const { view, setView } = useRunsView({ adopt: true });
  const k = clampK(params.get('k') ?? DEFAULT_K);
  const viewKey = filterKey(view);
  // Everything the filters allow except the task and dataset, which the two selects pick.
  const base: DashboardFilters = useMemo(
    () => withoutTaskAndDataset(viewToFilters({ ...DEFAULT_VIEW, ...JSON.parse(viewKey) } as RunsView)),
    [viewKey],
  );

  // Scope: which tasks exist, then which datasets exist for the chosen task.
  const scope = useModelCandidates(
    useMemo(() => ({ project_slug: slug, filters: base, k: 1, selected: {} }), [slug, base]),
  );
  const tasks = scopedOptions(view.tasks, scope.data?.scope.tasks ?? []);
  // Template strings: plain strings the React Compiler can tell apart from the option arrays.
  const task = `${chosenOption(view.tasks, tasks)}`;
  const datasetScope = useModelCandidates(
    useMemo(
      () => (task ? { project_slug: slug, filters: { ...base, tasks: [task] }, k: 1, selected: {} } : null),
      [slug, base, task],
    ),
  );
  const datasets = scopedOptions(view.datasets, datasetScope.data?.scope.datasets ?? []);
  const dataset = `${chosenOption(view.datasets, datasets)}`;

  // The facet lists, owner names and topbar KPIs follow the same filters as the Runs page.
  const overview = useOverview(
    slug,
    useMemo(() => viewToFilters({ ...DEFAULT_VIEW, ...JSON.parse(viewKey) } as RunsView), [viewKey]),
  );
  useKpiTopbar(overview.data?.kpis);
  const owners = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(overview.data?.owners ?? {}).map(([id, o]) => [id, o.display_name || o.email]),
      ),
    [overview.data?.owners],
  );
  const chips = activeChips(view, (id) => owners[id] ?? id);
  const summary = filterSummary(
    view,
    { total: overview.data?.total_count ?? 0, filtered: overview.data?.total_runs ?? 0 },
    { owner: (id) => owners[id] ?? id, dataset: datasetLabel },
  );

  // Hand-picked runs belong to one task, dataset and filter set: they reset when any of those change.
  const scopeKey = `${task}|${dataset}|${viewKey}`;
  const [customState, setCustomState] = useState<{ scope: string; picks: Record<string, string[]> }>({
    scope: '',
    picks: {},
  });
  const custom = useMemo(
    () => (customState.scope === scopeKey ? customState.picks : {}),
    [customState, scopeKey],
  );
  const setCustom = (
    next: Record<string, string[]> | ((c: Record<string, string[]>) => Record<string, string[]>),
  ) => setCustomState({ scope: scopeKey, picks: typeof next === 'function' ? next(custom) : next });
  const [editing, setEditing] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [shownState, setShownState] = useState<Set<string> | null>(null);

  const filters: DashboardFilters = useMemo(
    () => ({ ...base, tasks: [task], datasets: [dataset] }),
    [base, task, dataset],
  );
  const main = useModelCandidates(
    useMemo(
      () => (task && dataset ? { project_slug: slug, filters, k, selected: custom } : null),
      [slug, filters, k, custom, task, dataset],
    ),
  );
  const models = useMemo(() => main.data?.models ?? [], [main.data]);
  const allRuns: ModelRun[] = useMemo(() => models.flatMap((m) => m.rows), [models]);
  const metrics = useMemo(() => orderMetrics(allRuns, main.data?.metrics ?? []), [allRuns, main.data]);
  const metric =
    params.get('metric') && metrics.includes(params.get('metric')!)
      ? params.get('metric')!
      : defaultMetric(allRuns, metrics);

  const metricInfo = main.data?.metric_summary[metric];
  const isBoolean = Boolean(metricInfo?.is_boolean);
  const isNumeric = Boolean(metricInfo?.is_numeric);
  const spec = allRuns.map((r) => r.metric_specs?.[metric]).find((s) => s && typeof s === 'object');
  const direction: MetricDirection = metricDirection(spec);
  const kind = metricKind(isNumeric, direction);
  const threshold = thresholds[metric] ?? defaultPassThreshold(spec, direction);
  const canPass = showsThreshold(isBoolean, isNumeric, direction);

  const groups = useMemo(() => buildStatGroups(models, custom, k), [models, custom, k]);
  const rule = metric && models.length ? { metric, threshold, is_boolean: isBoolean, direction } : null;
  const stats = useModelStats(groups, rule);
  const showSkeleton = useDelayedPending(
    Boolean(task && dataset) && (main.isPending || (stats.isPending && models.length > 0)),
  );

  const hasTrace = allRuns.some((r) => Object.keys(traceAverages([r])).length > 0);
  const tileDefs = statTiles(kind, k, direction, Math.round(threshold * 100), isBoolean, hasTrace);
  const statOptions = [
    ...tileDefs.map((t) => ({ key: t.key, label: t.label })),
    ...(kind === 'score' ? [{ key: 'correctDistribution', label: 'Correct distribution' }] : []),
  ];
  const shown = shownState ?? new Set(statOptions.map((o) => o.key));

  const ranked = useMemo(() => {
    const items = models.map((m) => ({ key: m.model_key, avg: stats.data?.[m.model_key]?.avgScore ?? null }));
    return rankModels(items, direction);
  }, [models, stats.data, direction]);
  const colorIndex = useMemo(
    () =>
      new Map(
        [...models]
          .map((m) => m.model_key)
          .sort()
          .map((key, i) => [key, i]),
      ),
    [models],
  );
  const editModel = models.find((m) => m.model_key === editing);

  const setParam = (key: string, value: string | null) => replaceUrlQuery({ [key]: value });
  const selectKey = (key: Key | null) => (key === null ? null : String(key));

  return (
    <div className={constrained} data-models-page>
      <PageHeader
        title="Models"
        description="Compare models on one task and dataset over their most recent runs."
      />
      <div className={styles.page}>
        <div className={styles.bar}>
          <FiltersPopover
            view={view}
            facets={overview.data?.facets}
            owners={owners}
            onChange={(patch) => setView(patch)}
          />
          <Select
            label="Task"
            width="14em"
            items={tasks.map((t) => ({ key: t, label: t }))}
            value={task || null}
            placeholder="Select a task"
            onChange={(key) => {
              const next = selectKey(key);
              setView({ tasks: next ? [next] : [], datasets: [] });
            }}
          />
          <Select
            label="Dataset"
            width="14em"
            items={datasets.map((d) => ({ key: d, label: datasetLabel(d) }))}
            value={dataset || null}
            isDisabled={!task}
            placeholder={task ? 'Select a dataset' : 'Pick a task first'}
            onChange={(key) => {
              const next = selectKey(key);
              setView({ datasets: next ? [next] : [] });
            }}
          />
          {chips.length ? (
            <div className={styles.chips} role="group" aria-label="Active filters">
              {chips.map((c) => (
                <Chip
                  key={c.id}
                  isSelected
                  onRemove={() => setView(c.remove)}
                  removeLabel={`Remove ${c.label}`}
                >
                  {c.label}
                </Chip>
              ))}
              <Button
                variant="ghost"
                onPress={() => setView({ ...DEFAULT_VIEW, versioning: {}, sort: view.sort })}
              >
                Clear {chips.length}
              </Button>
            </div>
          ) : null}
        </div>
        <p className={styles.muted} data-testid="models-summary">
          {summary}
        </p>

        {scope.isError ? (
          <ErrorState
            error={scope.error}
            title="Could not load models"
            onRetry={() => void scope.refetch()}
          />
        ) : !scope.data ? (
          <Skeleton kind="cards" count={3} label="Loading models" />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<Icon name="grid" />}
            title="No runs in this period"
            body="Widen the time range or origin to see models."
          />
        ) : !task || !dataset ? (
          <EmptyState
            icon={<Icon name="grid" />}
            title="Select a task and dataset"
            body="The Models view compares models on exactly one task and one dataset. Pick both above."
          />
        ) : main.isError ? (
          <ErrorState error={main.error} title="Could not load models" onRetry={() => void main.refetch()} />
        ) : (
          <>
            <div className={styles.controls}>
              <Select
                label="Metric"
                width="14em"
                items={metrics.map((m) => ({ key: m, label: m }))}
                value={metric || null}
                onChange={(key) => setParam('metric', selectKey(key))}
              />
              <NumberField
                label="Runs per model"
                value={k}
                minValue={1}
                maxValue={100}
                step={1}
                width="7em"
                onChange={(v) => {
                  if (Number.isNaN(v)) return;
                  setCustom({});
                  setParam('k', clampK(v) === DEFAULT_K ? null : String(clampK(v)));
                }}
              />
              {canPass ? (
                <Slider
                  label={direction === 'minimize' ? 'Pass ≤' : 'Pass ≥'}
                  unit="%"
                  minValue={0}
                  maxValue={100}
                  step={5}
                  width="12em"
                  value={Math.round(threshold * 100)}
                  onChange={(v) => setThresholds((t) => ({ ...t, [metric]: v / 100 }))}
                />
              ) : null}
              <MultiSelect
                label="Shown metrics"
                items={statOptions}
                value={shown}
                searchable={false}
                onChange={(keys) => setShownState(new Set([...keys].map(String)))}
              />
              <span className={styles.grow} />
              {stats.dataUpdatedAt ? (
                <span className={styles.status}>
                  Last updated {new Date(stats.dataUpdatedAt).toLocaleTimeString()}
                </span>
              ) : null}
            </div>

            {models.length === 0 ? (
              <EmptyState
                icon={<Icon name="grid" />}
                title="No runs found"
                body="No runs match this task and dataset."
              />
            ) : stats.isError ? (
              <ErrorState
                error={stats.error}
                title="Could not load model statistics"
                onRetry={() => void stats.refetch()}
              />
            ) : showSkeleton || !stats.data ? (
              <Skeleton kind="cards" count={Math.min(models.length, 4)} label="Loading models" />
            ) : (
              <>
                <div className={styles.grid}>
                  {ranked.map(({ key }) => {
                    const m = models.find((x) => x.model_key === key)!;
                    const s = stats.data![key];
                    if (!s) return null;
                    const ids = selectedRunIds(m, custom[key], k);
                    const retries = m.rows
                      .filter((r) => ids.includes(r.run_id))
                      .reduce((n, r) => n + Number(r.total_retries ?? 0), 0);
                    return (
                      <ModelCard
                        key={key}
                        modelKey={key}
                        colorIndex={colorIndex.get(key) ?? 0}
                        stats={{
                          ...s,
                          totalRetries: retries,
                          traceAverages: traceAverages(m.rows.filter((r) => ids.includes(r.run_id))),
                        }}
                        hasTrace={hasTrace}
                        selectedCount={ids.length}
                        availableCount={m.total_runs}
                        k={k}
                        kind={kind}
                        direction={direction}
                        isBoolean={isBoolean}
                        thresholdPct={Math.round(threshold * 100)}
                        shown={shown}
                        runIds={ids}
                        onEdit={() => setEditing(key)}
                      />
                    );
                  })}
                </div>
                <section className={styles.ranking} aria-labelledby="models-ranking">
                  <h2 className={styles.rankTitle} id="models-ranking">
                    {direction
                      ? `Ranking by ${isNumeric ? 'average value' : 'average score'}${direction === 'minimize' ? ', lower is better' : ''}`
                      : `Models (${metric} declares no direction, so there is no ranking)`}
                  </h2>
                  <ol className={styles.rankList}>
                    {ranked.map((item, i) => {
                      const { label } = parseModelKey(item.key);
                      return (
                        <li key={item.key} className={styles.rankItem}>
                          <span className={styles.rank}>
                            {direction && item.avg !== null ? (
                              i < MEDALS.length ? (
                                <span role="img" aria-label={`Rank ${i + 1}`}>
                                  {MEDALS[i]}
                                </span>
                              ) : (
                                `#${i + 1}`
                              )
                            ) : (
                              ''
                            )}
                          </span>
                          <span>{label}</span>
                          <ScoreValue
                            variant="pill"
                            value={item.avg}
                            direction={isNumeric ? null : direction}
                            digits={1}
                            text={
                              item.avg === null
                                ? '—'
                                : isNumeric
                                  ? item.avg.toFixed(2)
                                  : formatPercent(item.avg, 1)
                            }
                          />
                        </li>
                      );
                    })}
                  </ol>
                </section>
              </>
            )}
          </>
        )}
      </div>
      {editModel ? (
        <RunSelectionDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          slug={slug}
          modelKey={editModel.model_key}
          modelLabel={parseModelKey(editModel.model_key).label}
          filters={filters}
          metric={metric}
          k={k}
          initial={selectedRunIds(editModel, custom[editModel.model_key], k)}
          onApply={(ids) => setCustom((c) => ({ ...c, [editModel.model_key]: ids }))}
        />
      ) : null}
    </div>
  );
}
