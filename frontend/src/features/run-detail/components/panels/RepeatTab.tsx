/** Repeat-run analysis (round 3 P2): one metric drives the tiles, the curve and the distribution; the table shows every pass. */
import { useMemo, useState } from 'react';
import { useGroupMetricsQuery, usePassesQuery } from '@/api/runs';
import { formatPercent } from '@/lib/metrics';
import {
  DataTable,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Tag,
  type Column,
} from '@/ui';
import { useColumnStep } from '../../lib/columnStep';
import {
  queuedLabel,
  repeatCopy,
  statisticOptions,
  verdictLine,
  type RepeatStatistic,
} from '../../lib/repeatCopy';
import { useRunPage } from '../../RunContext';
import { Curve, CurveLegend, PassCountBars, type CurvePoint } from '../charts/Charts';
import { ChartCard } from '../charts/ChartCard';
import { PassTable } from './PassTable';
import { RepeatTiles } from './RepeatTiles';
import styles from './Repeat.module.css';

export function RepeatTab() {
  const { runId, model, api, basePath } = useRunPage();
  const [rootRef, step, width] = useColumnStep<HTMLDivElement>();
  // The page's analysis metric (?metric=, default the primary metric) is the one that drives this section.
  const metric = api.selectedMetric ?? model.metricNames[0] ?? '';
  const boolean = !!model.metricIsBoolean[metric];
  const baseThreshold = boolean ? 1 : (model.defaultThresholds[metric] ?? 0.8);
  const [tState, setTState] = useState<{ metric: string; draft: number; committed: number } | null>(null);
  const mine = tState?.metric === metric ? tState : null;
  const threshold = mine?.draft ?? baseThreshold;
  const committed = mine?.committed ?? baseThreshold;
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [statistic, setStatistic] = useState<RepeatStatistic>('compare');
  const [extraMetrics, setExtraMetrics] = useState<Set<string>>(() => new Set());
  const [extraStats, setExtraStats] = useState<Set<string>>(() => new Set());
  const passes = usePassesQuery(runId, true);
  const group = useGroupMetricsQuery(runId, metric, committed, true);
  const g = group.data;
  const k = g?.group?.k ?? model.samples;
  const direction = model.metricDirections[metric] ?? null;
  const passBased = model.metricTypes[metric] !== 'numeric' && !!direction;
  const options = statisticOptions(passBased);
  const selected = options.find((o) => o.key === statistic) ?? options[0]!;
  const copy = repeatCopy(k, boolean, Math.round(committed * 100), direction);

  const curve = useMemo(() => {
    const band = g?.band ?? {};
    const ks = Object.keys(band)
      .map(Number)
      .sort((a, b) => a - b);
    const pt = (key: 'pass_at_k' | 'pass_hat_k'): CurvePoint[] =>
      ks.map((kk) => ({
        k: kk,
        value: band[String(kk)]?.[key] ?? null,
        low: band[String(kk)]?.uncertainty?.[key]?.low,
        high: band[String(kk)]?.uncertainty?.[key]?.high,
      }));
    const average = ks.map((kk) => ({
      k: kk,
      value: band[String(kk)]?.cumulative_avg ?? null,
      low: band[String(kk)]?.uncertainty?.cumulative_avg?.low,
      high: band[String(kk)]?.uncertainty?.cumulative_avg?.high,
    }));
    return {
      pass_at_k: { name: 'Pass@k', tone: 'var(--chart-1)', points: pt('pass_at_k') },
      pass_hat_k: { name: 'Pass^k', tone: 'var(--chart-5)', dash: true, points: pt('pass_hat_k') },
      cumulative_avg: { name: 'Average', tone: 'var(--chart-2)', points: average },
    };
  }, [g]);

  const shownSeries =
    selected.key === 'compare'
      ? [curve.pass_at_k, curve.pass_hat_k]
      : [curve[selected.key as 'pass_at_k' | 'pass_hat_k' | 'cumulative_avg']];
  const numericAverage = selected.key === 'cumulative_avg' && model.metricTypes[metric] === 'numeric';
  const curveValues = shownSeries
    .flatMap((sr) => sr.points.flatMap((p) => [p.value, p.low, p.high]))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const hasCurve = curveValues.length > 0;
  const domain: [number, number] = (() => {
    if (!numericAverage || !curveValues.length) return [0, 1];
    const lo = Math.min(...curveValues);
    const hi = Math.max(...curveValues);
    const pad = Math.max(1, Math.abs(hi) * 0.1, (hi - lo) * 0.25);
    return [lo - pad / 2, hi + pad / 2];
  })();
  const stats = g?.group;
  const allPasses = passes.data?.passes ?? [];
  const donePasses = allPasses.filter((p) => p.status !== 'pending' && !p.queued);
  const queued = queuedLabel(allPasses.length - donePasses.length, allPasses.length, model.samples);
  const errors = donePasses.reduce((a, p) => a + (p.error_count ?? 0), 0);
  const latencies = donePasses.map((p) => p.avg_latency_ms).filter((v): v is number => typeof v === 'number');
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const verdict = verdictLine(stats, k);
  const metricItems = model.metricNames.map((m) => ({
    key: m,
    label: m,
    description: model.metricIsBoolean[m] ? 'True / False' : undefined,
  }));
  if (model.metricNames.length === 0) return null;
  return (
    <div className={styles.root} ref={rootRef} data-testid="repeat-analysis" data-step={step}>
      <div className={styles.control}>
        {model.metricNames.length > 1 ? (
          <Select
            label="Metric"
            items={metricItems}
            value={metric}
            width={280}
            onChange={(m) => {
              if (!m) return;
              api.setView({ metric: String(m) === model.defaultMetric ? null : String(m), threshold: null });
            }}
          />
        ) : (
          <Tag kind="data">{metric}</Tag>
        )}
        <p className={styles.controlHelp}>
          One metric drives the tiles, the curve and the distribution. The table below shows every pass.
        </p>
        {!boolean ? (
          <Slider
            label="Pass if score"
            unit="%"
            minValue={0}
            maxValue={100}
            step={5}
            value={Math.round(threshold * 100)}
            onChange={(v) => setTState({ metric, draft: (v as number) / 100, committed })}
            onChangeEnd={(v) =>
              setTState({ metric, draft: (v as number) / 100, committed: (v as number) / 100 })
            }
            width="140px"
          />
        ) : null}
      </div>
      {group.isPending ? <Skeleton kind="cards" count={1} label="Loading repeat analysis" /> : null}
      {group.isError ? (
        <ErrorState
          compact
          error={group.error}
          title="Repeat analysis did not load"
          onRetry={() => void group.refetch()}
        />
      ) : null}
      {g?.error ? <p className={styles.empty}>{g.error}</p> : null}
      {stats ? (
        <>
          {verdict ? (
            <p className={styles.verdict} data-testid="repeat-verdict">
              {verdict}
            </p>
          ) : null}
          <RepeatTiles
            stats={stats}
            k={k}
            metric={metric}
            metricType={model.metricTypes[metric]}
            direction={direction}
            passBased={passBased}
            avgLatencyMs={avgLatency}
            errors={errors}
            copy={copy}
          />
        </>
      ) : null}
      {g?.band || g?.distribution?.length ? (
        <div className={styles.twoUp}>
          {g?.band ? (
            <ChartCard
              title="Across attempts"
              ariaLabel="Performance across attempts"
              slot={false}
              legend={view === 'chart' && hasCurve ? <CurveLegend series={shownSeries} /> : undefined}
              controls={
                <>
                  {options.length > 1 ? (
                    <SegmentedControl
                      label="Repeat performance view"
                      options={options.map((o) => ({ value: o.key, label: o.label }))}
                      value={selected.key}
                      onChange={setStatistic}
                    />
                  ) : null}
                  <SegmentedControl
                    label="Curve view"
                    options={[
                      { value: 'chart', label: 'Chart' },
                      { value: 'table', label: 'Table' },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                </>
              }
              intro={<p className={styles.introCopy}>{selected.copy}</p>}
            >
              {!hasCurve ? (
                <p className={styles.empty} data-testid="curve-empty">
                  Every pass errored, so there is no {selected.label.toLowerCase()} to show.
                </p>
              ) : view === 'chart' ? (
                <Curve
                  series={shownSeries}
                  label={`${selected.label} for ${metric}`}
                  domain={domain}
                  format={numericAverage ? (v) => String(Math.round(v * 100) / 100) : undefined}
                  xLabel={selected.key === 'cumulative_avg' ? 'n' : 'k'}
                />
              ) : (
                <CurveTable
                  series={shownSeries}
                  selectedLabel={selected.label}
                  passesAxis={selected.key === 'cumulative_avg'}
                  numeric={numericAverage}
                />
              )}
            </ChartCard>
          ) : null}
          {g?.distribution?.length ? (
            <ChartCard
              title="Passes passed"
              ariaLabel="Distribution of passes passed"
              meta={<span className={styles.empty}>Items by passes that passed</span>}
              caption={`Passes passed, out of ${model.samples} (0 = always fail, ${model.samples} = always pass)`}
            >
              <PassCountBars
                counts={g.distribution}
                total={model.samples}
                selected={
                  api.view.filters.repeat?.metric === metric &&
                  api.view.filters.repeat.threshold === (g.threshold ?? committed)
                    ? api.view.filters.repeat.bucket
                    : null
                }
                onPick={(bucket) =>
                  api.setFilters({
                    repeat: { metric, bucket, samples: model.samples, threshold: g.threshold ?? committed },
                    score: null,
                  })
                }
              />
            </ChartCard>
          ) : null}
        </div>
      ) : null}
      {donePasses.length ? (
        <PassTable
          passes={donePasses}
          model={model}
          metric={metric}
          basePath={basePath}
          extraMetrics={extraMetrics}
          onExtraMetrics={setExtraMetrics}
          extraStats={extraStats}
          onExtraStats={setExtraStats}
          compact={width < 640}
          medianHint={copy.medianLatency}
          queued={queued}
        />
      ) : !passes.isPending && !group.isPending ? (
        <EmptyState
          title="No completed pass yet"
          body="The analysis appears once a pass has finished."
          compact
        />
      ) : null}
    </div>
  );
}

/** The curve as a table (the Chart | Table switch of the Across attempts card). */
function CurveTable({
  series,
  selectedLabel,
  passesAxis,
  numeric,
}: {
  series: Array<{ name: string; points: CurvePoint[] }>;
  selectedLabel: string;
  passesAxis: boolean;
  numeric: boolean;
}) {
  const rows = (series[0]?.points ?? []).map((p, i) => ({ k: p.k, i }));
  const columns: Column<{ k: number; i: number }>[] = [
    {
      id: 'k',
      header: passesAxis ? 'Passes' : 'k',
      label: passesAxis ? 'Passes' : 'k',
      mono: true,
      cell: (r) => r.k,
    },
    ...series.map((sr) => ({
      id: sr.name,
      header: sr.name,
      label: sr.name,
      align: 'end' as const,
      mono: true,
      cell: (r: { k: number; i: number }) =>
        numeric
          ? String(Math.round((sr.points[r.i]?.value ?? 0) * 100) / 100)
          : formatPercent(sr.points[r.i]?.value ?? null, 1),
    })),
  ];
  return (
    <DataTable<{ k: number; i: number }>
      aria-label={`${selectedLabel} values`}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.k}
      density="compact"
      densityLocked
      columnMenu={false}
      zebra={false}
      variant="embedded"
      stickyHeader={false}
      responsive="scroll"
    />
  );
}
