/**
 * The Charts scatter (C052): one dot per run in the page filters, in its model's colour, with X and Y picks, Pearson r
 * and a model key. It is the run page's Deep analysis scatter card, fed with runs in place of items. Select a dot to
 * open its run.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCATTER_MAX_RUNS, useScatterPoints } from '@/api/dashboard';
import type { DashboardFilters, MetricType, RunRow } from '@/api/dashboardTypes';
import { runPath } from '@/app/routes';
import { ChartCard } from '@/features/run-detail/components/charts/ChartCard';
import { Scatter, type ScatterPoint } from '@/features/run-detail/components/charts/Charts';
import { pearson } from '@/features/run-detail/lib/overviewModel';
import { formatLatency } from '@/lib/format';
import { ErrorState, Select, Skeleton } from '@/ui';
import { ModelMark } from './cells';
import { useRunsCtx } from './context';
import { modelSlot, plainModelName } from './model';
import { scatterAxes, scatterValue, LATENCY_AXIS } from './scatterModel';
import styles from './ChartsPage.module.css';

export function RunScatterCard({
  slug,
  filters,
  metricTypes,
}: {
  slug: string;
  filters: DashboardFilters;
  metricTypes: Record<string, MetricType>;
}) {
  const navigate = useNavigate();
  const { modelIndex } = useRunsCtx();
  const q = useScatterPoints(slug, filters);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = q;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, q.data?.pages.length]);
  const rows: RunRow[] = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.rows), [q.data]);
  const axes = useMemo(() => scatterAxes(rows), [rows]);
  const [pick, setPick] = useState<{ x: string; y: string } | null>(null);
  const x = pick && axes.options.includes(pick.x) ? pick.x : LATENCY_AXIS;
  const y = pick && axes.options.includes(pick.y) ? pick.y : axes.defaultY;
  const points: ScatterPoint[] = useMemo(
    () =>
      rows.flatMap((r) => {
        const xv = scatterValue(r, x);
        const yv = scatterValue(r, y);
        if (xv === null || yv === null) return [];
        return [
          {
            id: r.run_id,
            label: r.run_name || r.external_run_id || r.run_id.slice(0, 8),
            x: xv,
            y: yv,
            series: modelSlot(r.model_key, modelIndex),
          },
        ];
      }),
    [rows, x, y, modelIndex],
  );
  const r = points.length > 2 ? pearson(points.map((p) => [p.x, p.y])) : null;
  const models = [...new Set(rows.map((row) => row.model_key))];
  const label = (axis: string) => (axis === LATENCY_AXIS ? 'Avg latency' : axis.replace(/_/g, ' '));
  const fmt = (axis: string) => (v: number) =>
    axis === LATENCY_AXIS
      ? formatLatency(v)
      : metricTypes[axis] === 'numeric'
        ? String(Math.round(v * 100) / 100)
        : `${Math.round(v * 100)}%`;
  const items = axes.options.map((a) => ({ key: a, label: label(a) }));
  const loading = q.isPending || hasNextPage;

  if (q.isError)
    return (
      <ErrorState
        compact
        error={q.error}
        title="Couldn’t load the runs for the scatter"
        onRetry={() => q.refetch()}
      />
    );
  if (!loading && (!axes.defaultY || points.length < 2)) return null;
  return (
    <ChartCard
      title={`${label(y)} versus ${label(x)}`}
      slot={false}
      className={styles.scatterCard}
      data-testid="charts-scatter"
      controls={
        <span className={styles.scatterControls}>
          <span className={styles.axisPick} aria-hidden="true">
            X
          </span>
          <Select
            label="X"
            hideLabel
            items={items}
            value={x}
            onChange={(k) => k && setPick({ x: String(k), y })}
            width="18ch"
          />
          <span className={styles.axisPick} aria-hidden="true">
            Y
          </span>
          <Select
            label="Y"
            hideLabel
            items={items}
            value={y}
            onChange={(k) => k && setPick({ x, y: String(k) })}
            width="18ch"
          />
          <span className={styles.rValue}>
            r <b>{r === null ? '—' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}`}</b>
          </span>
        </span>
      }
      intro={
        <div className={styles.scatterIntro}>
          <p className={styles.scatterNote}>
            One dot per run in the page filters
            {rows.length >= SCATTER_MAX_RUNS ? ` (the newest ${SCATTER_MAX_RUNS})` : ''}. Select a dot to open
            its run.
          </p>
          <ul className={styles.scatterKey} aria-label="Models">
            {models.map((m) => (
              <li key={m}>
                <ModelMark modelKey={m} />
                {plainModelName(m)}
              </li>
            ))}
          </ul>
        </div>
      }
    >
      {loading ? (
        <Skeleton kind="chart" height={240} label="Loading the runs for the scatter" />
      ) : (
        <Scatter
          fit
          noun="runs"
          points={points}
          xLabel={label(x)}
          yLabel={label(y)}
          fmt={fmt(y)}
          fmtX={fmt(x)}
          fmtY={fmt(y)}
          onPick={(id) => navigate(runPath(slug, id))}
        />
      )}
    </ChartCard>
  );
}
