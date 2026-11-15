/**
 * "By pass" (round 10, the first qym's table): the main table of the repeat analysis, right under the tiles. One row
 * per pass, every metric as a column (no picker), then Avg latency and Median latency (with the zap Icon), Errors and
 * Items. Values are centred; the best and the worst pass of each metric are a subtle green and red highlight behind the
 * value, with no word (cv4 C1-6; the title and a hidden word keep the meaning for a screen reader). A row lights its
 * edge on hover (`hoverEdge`); nothing resizes or reorders.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatPercent, type MetricDirection } from '@/lib/metrics';
import { DataTable, ScoreValue, type Column } from '@/ui';
import { BoltLabel } from '@/features/runs-list/cells';
import type { RunModel } from '../../lib/runModel';
import { latencyLabel } from '../../lib/rowDisplay';
import type { PassSummary } from '../../types';
import styles from './Repeat.module.css';

/**
 * Best and worst passes on one metric (empty when the metric has no direction or every shown value is the same).
 * cv4 Y13: passes compare on the value as shown (`shown`, the rounded cell text), so every pass that ties for the best
 * or the worst shown value is marked, not only one of them.
 */
export function passExtremes(
  passes: Array<{ pass_number: number; metric_means?: Record<string, number | null> | null }>,
  metric: string,
  direction: string | null,
  shown: (v: number) => string = (v) => v.toFixed(3),
): { best: number[]; worst: number[] } {
  const none = { best: [], worst: [] };
  if (!direction) return none;
  const vals = passes
    .map((p) => ({ n: p.pass_number, v: p.metric_means?.[metric] }))
    .filter((p): p is { n: number; v: number } => typeof p.v === 'number')
    .map((p) => ({ ...p, s: shown(p.v) }));
  if (vals.length < 2) return none;
  const sorted = [...vals].sort((a, b) => (direction === 'minimize' ? a.v - b.v : b.v - a.v));
  const top = sorted[0]!.s;
  const bottom = sorted[sorted.length - 1]!.s;
  if (top === bottom) return none;
  return {
    best: vals.filter((p) => p.s === top).map((p) => p.n),
    worst: vals.filter((p) => p.s === bottom).map((p) => p.n),
  };
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
      new Map(
        metrics.map(
          (m) =>
            [
              m,
              passExtremes(passes, m, model.metricDirections[m] ?? null, (v) => metricText(model, m, v)),
            ] as const,
        ),
      ),
    [metrics, passes, model],
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
          data-link="name"
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
        const extreme = ext?.best.includes(p.pass_number)
          ? 'best'
          : ext?.worst.includes(p.pass_number)
            ? 'worst'
            : null;
        return (
          <span
            className={styles.metricCell}
            data-selected={m === metric ? '' : undefined}
            data-extreme={v == null ? undefined : (extreme ?? undefined)}
            title={
              v != null && extreme ? `${extreme === 'best' ? 'Best' : 'Worst'} pass for ${m}` : undefined
            }
          >
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
            {v != null && extreme ? <span className={styles.srOnly}>, {extreme} pass</span> : null}
          </span>
        );
      },
    })),
    {
      id: 'latency',
      header: <BoltLabel label="Avg latency" />,
      label: 'Avg latency',
      align: 'center',
      mono: true,
      resizable: false,
      cell: (p) => (p.avg_latency_ms != null ? latencyLabel(p.avg_latency_ms) : '—'),
    },
    {
      id: 'median',
      header: <BoltLabel label="Median latency" />,
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
        stripe="report"
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
