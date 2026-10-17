/** "By pass" (round 3 P2): one DataTable in a flush Card; the selected metric by default, a Metrics picker for more columns. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatPercent, type MetricDirection } from '@/lib/metrics';
import { Card, DataTable, MultiSelect, ScoreValue, Tag, Text, type Column, type Key } from '@/ui';
import type { RunModel } from '../../lib/runModel';
import { latencyLabel } from '../../lib/rowDisplay';
import type { PassSummary } from '../../types';
import styles from './Repeat.module.css';

/** Columns that are not metrics but can be picked when the table is compact. */
export const STAT_COLUMNS = [
  { key: 'col:latency', label: 'Avg latency' },
  { key: 'col:median', label: 'Median latency' },
  { key: 'col:items', label: 'Items' },
] as const;

/** Best and worst pass on the selected metric (null when fewer than two differ, or the metric has no direction). */
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

/** The metric columns shown, selected one first, then the extra picks in run order. */
export function shownMetrics(metricNames: string[], selected: string, extra: Set<string>): string[] {
  return [selected, ...metricNames.filter((m) => m !== selected && extra.has(m))];
}

export interface PassTableProps {
  passes: PassSummary[];
  model: RunModel;
  metric: string;
  basePath: string;
  /** Metric columns picked beyond the selected one. */
  extraMetrics: Set<string>;
  onExtraMetrics: (next: Set<string>) => void;
  /** Stat columns picked while compact. */
  extraStats: Set<string>;
  onExtraStats: (next: Set<string>) => void;
  /** Under 640px of column the table keeps Pass, the metric and Errors; the others are picked in the menu. */
  compact: boolean;
  medianHint: string;
  queued: string | null;
}

function metricText(model: RunModel, m: string, v: number | null | undefined): string {
  if (v == null) return '—';
  return model.metricTypes[m] === 'numeric' ? String(Math.round(v * 10) / 10) : formatPercent(v, 1);
}

export function PassTable({
  passes,
  model,
  metric,
  basePath,
  extraMetrics,
  onExtraMetrics,
  extraStats,
  onExtraStats,
  compact,
  medianHint,
  queued,
}: PassTableProps) {
  const direction: MetricDirection = model.metricDirections[metric] ?? null;
  const extremes = useMemo(() => passExtremes(passes, metric, direction), [passes, metric, direction]);
  const shown = shownMetrics(model.metricNames, metric, extraMetrics);
  const showStat = (key: string) => !compact || extraStats.has(`col:${key}`);

  const metricColumn = (m: string, selected: boolean): Column<PassSummary> => ({
    id: `metric:${m}`,
    header: m,
    label: m,
    type: 'text',
    align: 'end',
    mono: true,
    width: compact ? 110 : undefined,
    minWidth: compact ? 80 : 128,
    cell: (p) => {
      const v = p.metric_means?.[m];
      const dir = model.metricDirections[m] ?? null;
      return (
        <span
          className={styles.metricCell}
          data-selected={selected ? '' : undefined}
          data-compact={compact ? '' : undefined}
        >
          {v == null ? (
            '—'
          ) : (
            <ScoreValue
              value={v}
              type={model.metricTypes[m]}
              direction={dir}
              digits={1}
              text={metricText(model, m, v)}
            />
          )}
          {selected && extremes.best === p.pass_number ? <Tag tone="success">best</Tag> : null}
          {selected && extremes.worst === p.pass_number ? <Tag tone="danger">worst</Tag> : null}
        </span>
      );
    },
  });

  const columns: Column<PassSummary>[] = [
    {
      id: 'pass',
      header: 'Pass',
      label: 'Pass',
      pin: 'start',
      lockOrder: true,
      width: compact ? 84 : undefined,
      minWidth: compact ? 72 : 104,
      cell: (p) => (
        <Link
          to={`${basePath}?pass=${p.pass_number}`}
          aria-label={`Open pass ${p.pass_number}`}
          className={styles.passLink}
        >
          <Tag kind="count">Pass {p.pass_number}</Tag>
        </Link>
      ),
    },
    metricColumn(metric, true),
    ...shown.slice(1).map((m) => metricColumn(m, false)),
    ...(showStat('latency')
      ? [
          {
            id: 'latency',
            header: 'Avg latency',
            label: 'Avg latency',
            align: 'end' as const,
            mono: true,
            cell: (p: PassSummary) => (p.avg_latency_ms != null ? latencyLabel(p.avg_latency_ms) : '—'),
          },
        ]
      : []),
    ...(showStat('median')
      ? [
          {
            id: 'median',
            header: 'Median',
            label: 'Median latency',
            hint: medianHint,
            align: 'end' as const,
            mono: true,
            cell: (p: PassSummary) => (p.median_latency_ms != null ? latencyLabel(p.median_latency_ms) : '—'),
          },
        ]
      : []),
    {
      id: 'errors',
      header: 'Errors',
      label: 'Errors',
      width: compact ? 62 : undefined,
      minWidth: compact ? 44 : 56,
      align: 'end',
      mono: true,
      cell: (p) => (
        <span data-tone={(p.error_count ?? 0) > 0 ? 'danger' : undefined} className={styles.errors}>
          {p.error_count ?? 0}
        </span>
      ),
    },
    ...(showStat('items')
      ? [
          {
            id: 'items',
            header: 'Items',
            label: 'Items',
            align: 'end' as const,
            mono: true,
            cell: (p: PassSummary) => p.items_total ?? '',
          },
        ]
      : []),
  ];

  const pickable = [
    ...model.metricNames.map((m) => ({ key: m as Key, label: m })),
    ...(compact ? STAT_COLUMNS.map((c) => ({ key: c.key as Key, label: c.label })) : []),
  ];
  const value = new Set<Key>([metric, ...extraMetrics, ...extraStats]);
  const onChange = (next: Set<Key>) => {
    const metrics = new Set<string>();
    const stats = new Set<string>();
    next.forEach((k) => {
      const key = String(k);
      if (key === metric) return;
      if (key.startsWith('col:')) stats.add(key);
      else metrics.add(key);
    });
    onExtraMetrics(metrics);
    onExtraStats(stats);
  };

  return (
    <Card
      as="section"
      aria-label="Passes"
      flush
      className={styles.passCard}
      header={
        <div className={styles.passHead}>
          <span className={styles.title}>By pass</span>
          <span className={styles.passHeadRight}>
            <Text variant="sm" tone="muted" data-testid="metrics-shown">
              Metrics shown: {metric} ({shown.length} of {model.metricNames.length})
            </Text>
            {model.metricNames.length > 1 ? (
              <MultiSelect
                label="Metrics"
                items={pickable}
                value={value}
                onChange={onChange}
                onlyAction={false}
              />
            ) : null}
          </span>
        </div>
      }
    >
      <DataTable<PassSummary>
        aria-label="Passes"
        columns={columns}
        rows={passes}
        rowKey={(p) => p.pass_number}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        variant="embedded"
        stickyHeader={false}
        responsive="scroll"
      />
      {queued ? (
        <p className={styles.queued} data-testid="queued-passes">
          {queued}
        </p>
      ) : null}
    </Card>
  );
}
