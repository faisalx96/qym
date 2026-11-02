/** The statistic tiles of the repeat analysis (round 3 P2): seven separate centred tiles, three for a metric without pass rates. */
import {
  formatLatency,
  formatPercent,
  metricBand,
  type MetricDirection,
  type MetricType,
} from '@/lib/metrics';
import { StatTiles, type StatTile } from '@/ui';
import type { GroupMetricsPayload } from '../../types';
import { tileMeaning, type RepeatCopy } from '../../lib/repeatCopy';

export interface RepeatTilesProps {
  stats: NonNullable<GroupMetricsPayload['group']>;
  /** Passes per item. */
  k: number;
  metric: string;
  metricType: MetricType | undefined;
  direction: MetricDirection;
  /** Pass rates exist (the metric has a direction and is not a raw number). */
  passBased: boolean;
  avgLatencyMs: number | null;
  errors: number;
  copy: RepeatCopy;
}

type Band = 1 | 2 | 3 | 4 | 5;

/** Tiles in the legacy order: Pass@k, Pass^k, Consistency, Reliability, Avg score, Avg latency, Errors. */
export function repeatTileItems({
  stats,
  k,
  metric,
  metricType,
  direction,
  passBased,
  avgLatencyMs,
  errors,
  copy,
}: RepeatTilesProps): StatTile[] {
  // A pass rate is higher-is-better whatever the metric's own direction is; only the mean follows the metric.
  const rate = (v: number | null | undefined): Band | undefined =>
    v == null ? undefined : (metricBand(v, 'percentage', 'maximize') ?? undefined);
  const avgText =
    metricType === 'numeric'
      ? String(Math.round((stats.avg_at_k ?? 0) * 100) / 100)
      : formatPercent(stats.avg_at_k ?? null, 1);
  const avg: StatTile = {
    key: 'avg',
    label: 'Avg score',
    help: copy.avgScore,
    value: avgText,
    meaning: tileMeaning('avg', k, metric),
    band:
      stats.avg_at_k == null || !direction
        ? undefined
        : (metricBand(stats.avg_at_k, metricType, direction) ?? undefined),
  };
  const tail: StatTile[] = [
    {
      key: 'latency',
      label: 'Avg latency',
      help: copy.avgLatency,
      value: formatLatency(avgLatencyMs ?? undefined),
      meaning: tileMeaning('latency', k, metric),
    },
    {
      key: 'errors',
      label: 'Errors',
      help: copy.errors,
      value: String(errors),
      meaning: tileMeaning('errors', k, metric),
      danger: errors > 0,
    },
  ];
  if (!passBased) return [avg, ...tail];
  return [
    {
      key: 'pass_at_k',
      label: `Pass@${k}`,
      help: copy.passAtK,
      value: formatPercent(stats.pass_at_k ?? null, 1),
      meaning: tileMeaning('pass_at_k', k, metric),
      band: rate(stats.pass_at_k),
    },
    {
      key: 'pass_hat_k',
      label: `Pass^${k}`,
      help: copy.passHatK,
      value: formatPercent(stats.pass_hat_k ?? null, 1),
      meaning: tileMeaning('pass_hat_k', k, metric),
      band: rate(stats.pass_hat_k),
    },
    {
      key: 'consistency',
      label: 'Consistency',
      help: copy.consistency,
      value: formatPercent(stats.consistency ?? null, 1),
      meaning: tileMeaning('consistency', k, metric),
      band: rate(stats.consistency),
    },
    {
      key: 'reliability',
      label: 'Reliability',
      help: copy.reliability,
      value: formatPercent(stats.reliability ?? null, 1),
      meaning: tileMeaning('reliability', k, metric),
      band: rate(stats.reliability),
    },
    avg,
    ...tail,
  ];
}

export function RepeatTiles(props: RepeatTilesProps) {
  return <StatTiles aria-label="Repeat run statistics" items={repeatTileItems(props)} />;
}
