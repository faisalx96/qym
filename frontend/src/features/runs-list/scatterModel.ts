import type { RunRow } from '@/api/dashboardTypes';

/** The latency axis of the Charts scatter; every other axis is a metric name. */
export const LATENCY_AXIS = '__latency';

/** One run's value on an axis: its average latency, or its mean for a metric; null when it has none. */
export function scatterValue(row: RunRow, axis: string): number | null {
  const v = axis === LATENCY_AXIS ? row.avg_latency_ms : row.metric_averages?.[axis];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The axes the Charts scatter offers: latency, then every metric the runs have, the most scored first. The default Y
 * is the metric with the most scored runs (the X default is latency: "score versus latency").
 */
export function scatterAxes(rows: RunRow[]): { options: string[]; defaultY: string } {
  const counts = new Map<string, number>();
  for (const r of rows)
    for (const [m, v] of Object.entries(r.metric_averages ?? {}))
      if (Number.isFinite(v)) counts.set(m, (counts.get(m) ?? 0) + 1);
  const metrics = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([m]) => m);
  return { options: [LATENCY_AXIS, ...metrics], defaultY: metrics[0] ?? '' };
}
