/**
 * "By pass" (round 10, the first qym's table): the main table of the repeat analysis, right under the tiles. One row
 * per pass, every metric as a column (no picker), then Avg latency and Median latency (with the ⚡ glyph), Errors and
 * Items. Values are centred; the best and the worst pass of each metric carry a tag on the same line. A row
 * lights its edge on hover (`hoverEdge`); nothing resizes or reorders.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatPercent, type MetricDirection } from '@/lib/metrics';
import { DataTable, ScoreValue, type Column } from '@/ui';
import type { RunModel } from '../../lib/runModel';
import { latencyLabel } from '../../lib/rowDisplay';
import type { PassSummary } from '../../types';
import styles from './Repeat.module.css';

/** Best and worst pass on one metric (null when fewer than two differ, or the metric has no direction). */
export function passExtremes(
  passes: Array<{ pass_number: number; metric_means?: Record<string, number | null> | null }>,
  metric: string,
  direction: string | null,
): { best: number | null; worst: number | null } {
  if (!direction) return { best: null, worst: null };
  const vals = passes
    .map((p) => ({ n: p.pass_number, v: p.metric_means?.[metric] }))
    .filter((p): p is { n: number; v: number } => typeof p.v === 'number');
  if (vals.length < 2) return { best: null, worst: null };
  const sorted = [...vals].sort((a, b) => (direction === 'minimize' ? a.v - b.v : b.v - a.v));
  if (sorted[0]!.v === sorted[sorted.length - 1]!.v) return { best: null, worst: null };
  return { best: sorted[0]!.n, worst: sorted[sorted.length - 1]!.n };
}

export interface PassTableProps {
  passes: PassSummary[];
  model: RunModel;
  /** The page metric: its column comes first. */
  metric: string;
  basePath: string;
  medianHint: string;
  queued: string | null;
}

function metricText(model: RunModel, m: string, v: number): string {
  return model.metricTypes[m] === 'numeric' ? String(Math.round(v * 10) / 10) : formatPercent(v, 1);
}

export function PassTable({ passes, model, metric, basePath, medianHint, queued }: PassTableProps) {
  const metrics = useMemo(
    () => [metric, ...model.metricNames.filter((m) => m !== metric)],
    [metric, model.metricNames],
  );
  const extremes = useMemo(
    () =>
      new Map(metrics.map((m) => [m, passExtremes(passes, m, model.metricDirections[m] ?? null)] as const)),
    [metrics, passes, model.metricDirections],
  );
  const columns: Column<PassSummary>[] = [
    {
      id: 'pass',
      header: 'Pass',
      label: 'Pass',
      resizable: false,
      cell: (p) => (
        <Link
          to={`${basePath}?pass=${p.pass_number}`}
          aria-label={`Open pass ${p.pass_number}`}
          className={styles.passLink}
        >
          <span className={styles.passDot} aria-hidden="true" />
          Pass {p.pass_number}
        </Link>
      ),
    },
    ...metrics.map((m): Column<PassSummary> => ({
      id: `metric:${m}`,
      header: m,
      label: m,
      align: 'center',
      resizable: false,
      cell: (p) => {
        const v = p.metric_means?.[m];
        const ext = extremes.get(m);
        const dir: MetricDirection = model.metricDirections[m] ?? null;
        return (
          <span className={styles.metricCell} data-selected={m === metric ? '' : undefined}>
            {v == null ? (
              <span className={styles.none}>—</span>
            ) : (
              <ScoreValue
                value={v}
                type={model.metricTypes[m]}
                direction={dir}
                digits={1}
                variant="plain"
                text={metricText(model, m, v)}
              />
            )}
            <span className={styles.extreme}>
              {ext?.best === p.pass_number ? (
                <span className={styles.extremeWord} data-tone="success">
                  best
                </span>
              ) : null}
              {ext?.worst === p.pass_number ? (
                <span className={styles.extremeWord} data-tone="danger">
                  worst
                </span>
              ) : null}
            </span>
          </span>
        );
      },
    })),
    {
      id: 'latency',
      header: (
        <>
          <span className={styles.bolt} aria-hidden="true">
            ⚡
          </span>
          Avg latency
        </>
      ),
      label: 'Avg latency',
      align: 'center',
      mono: true,
      resizable: false,
      cell: (p) => (p.avg_latency_ms != null ? latencyLabel(p.avg_latency_ms) : '—'),
    },
    {
      id: 'median',
      header: (
        <>
          <span className={styles.bolt} aria-hidden="true">
            ⚡
          </span>
          Median latency
        </>
      ),
      label: 'Median latency',
      hint: medianHint,
      align: 'center',
      mono: true,
      resizable: false,
      cell: (p) => (p.median_latency_ms != null ? latencyLabel(p.median_latency_ms) : '—'),
    },
    {
      id: 'errors',
      header: 'Errors',
      label: 'Errors',
      align: 'center',
      mono: true,
      resizable: false,
      cell: (p) => {
        const n = p.error_count ?? 0;
        return (
          <span className={styles.errors} data-tone={n > 0 ? 'danger' : undefined}>
            {n}
          </span>
        );
      },
    },
    {
      id: 'items',
      header: 'Items',
      label: 'Items',
      align: 'center',
      mono: true,
      resizable: false,
      cell: (p) => p.items_total ?? '',
    },
  ];
  return (
    <section className={styles.passCard} aria-label="By pass">
      <DataTable<PassSummary>
        aria-label="Passes"
        columns={columns}
        rows={passes}
        rowKey={(p) => p.pass_number}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        hoverEdge
        variant="embedded"
        stickyHeader={false}
        responsive="scroll"
      />
      {queued ? (
        <p className={styles.queued} data-testid="queued-passes">
          {queued}
        </p>
      ) : null}
    </section>
  );
}
