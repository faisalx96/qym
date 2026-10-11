/**
 * /projects/:slug/models (brief 06 §2.10): compare models on one task and dataset over their last K
 * runs. Self-contained filter row (time range, origin, task, dataset in the URL), summary path only.
 */
import { useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  useModelCandidates,
  useModelStats,
  type DashboardFilters,
  type ModelRun,
} from '@/api/dashboardModels';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import { formatPercent, metricDirection, type MetricDirection } from '@/lib/metrics';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import {
  EmptyState,
  ErrorState,
  Icon,
  MultiSelect,
  NumberField,
  PageHeader,
  SegmentedControl,
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
  rangeSince,
  rankModels,
  selectedRunIds,
  showsThreshold,
  statTiles,
  type OriginFilter,
  type TimeRange,
} from './modelsLogic';
import { RunSelectionDialog } from './RunSelectionDialog';

const RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];
const ORIGINS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'official', label: 'Official' },
  { value: 'local', label: 'Local' },
];

const oneOf = <T extends string>(value: string | null, allowed: { value: T }[], fallback: T): T =>
  allowed.some((a) => a.value === value) ? (value as T) : fallback;

export function ModelsPage() {
  const { project, slug } = useProjectContext();
  useDocumentTitle(`${project.name} · Models`);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const range = oneOf(params.get('range'), RANGES, 'all');
  const origin = oneOf(params.get('origin'), ORIGINS, 'all');
  const k = clampK(params.get('k') ?? DEFAULT_K);
  const since = useMemo(() => rangeSince(range), [range]);
  const base: DashboardFilters = useMemo(
    () => ({ ...(origin !== 'all' ? { origins: [origin] } : {}), ...(since ? { since } : {}) }),
    [origin, since],
  );

  // Scope: which tasks exist, then which datasets exist for the chosen task.
  const scope = useModelCandidates(
    useMemo(() => ({ project_slug: slug, filters: base, k: 1, selected: {} }), [slug, base]),
  );
  const tasks = scope.data?.scope.tasks ?? [];
  const task =
    params.get('task') && tasks.includes(params.get('task')!)
      ? params.get('task')!
      : tasks.length === 1
        ? tasks[0]!
        : '';
  const datasetScope = useModelCandidates(
    useMemo(
      () => (task ? { project_slug: slug, filters: { ...base, tasks: [task] }, k: 1, selected: {} } : null),
      [slug, base, task],
    ),
  );
  const datasets = datasetScope.data?.scope.datasets ?? [];
  const dataset =
    params.get('dataset') && datasets.includes(params.get('dataset')!)
      ? params.get('dataset')!
      : datasets.length === 1
        ? datasets[0]!
        : '';

  const [custom, setCustom] = useState<Record<string, string[]>>({});
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

  const summary = main.data?.metric_summary[metric];
  const isBoolean = Boolean(summary?.is_boolean);
  const isNumeric = Boolean(summary?.is_numeric);
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

  const tileDefs = statTiles(kind, k, direction, Math.round(threshold * 100), isBoolean);
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
          <SegmentedControl
            label="Time range"
            options={RANGES}
            value={range}
            onChange={(v) => setParam('range', v === 'all' ? null : v)}
          />
          <SegmentedControl
            label="Origin"
            options={ORIGINS}
            value={origin}
            onChange={(v) => setParam('origin', v === 'all' ? null : v)}
          />
          <Select
            label="Task"
            width="14em"
            items={tasks.map((t) => ({ key: t, label: t }))}
            value={task || null}
            placeholder="Select a task"
            onChange={(key) => replaceUrlQuery({ task: selectKey(key), dataset: null, metric: null })}
          />
          <Select
            label="Dataset"
            width="14em"
            items={datasets.map((d) => ({ key: d, label: d }))}
            value={dataset || null}
            isDisabled={!task}
            placeholder={task ? 'Select a dataset' : 'Pick a task first'}
            onChange={(key) => replaceUrlQuery({ dataset: selectKey(key), metric: null })}
          />
        </div>

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
                        stats={{ ...s, totalRetries: retries }}
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
                            {direction && item.avg !== null ? `#${i + 1}` : ''}
                          </span>
                          <span>{label}</span>
                          <span>
                            (
                            {item.avg === null
                              ? '—'
                              : isNumeric
                                ? item.avg.toFixed(2)
                                : formatPercent(item.avg, 1)}
                            )
                          </span>
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
