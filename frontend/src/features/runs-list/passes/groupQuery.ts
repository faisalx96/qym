/**
 * Which metric and threshold the passes strip of a run opens with, from the run row alone, and what a finished run's
 * published summary already holds of its passes (C023: the strip and the pass rows then need no request).
 */
import type { GroupMetrics, MetricType, RunPasses, RunRow } from '@/api/dashboardTypes';
import { metricDirection, type MetricDirection } from '@/lib/metrics';
import { defaultMetricName, defaultPassThreshold, groupStatRule, toChartRun } from '../chartModel';
import { resolveMetric } from './rows';

export interface GroupChoice {
  /** The score metrics the strip's Metric select offers (numeric metrics have no pass statistics). */
  scoreMetrics: string[];
  /** The metric it opens with: the one remembered for this project if the run has it, else the run's default. */
  metric: string | null;
  direction: MetricDirection;
  /** The threshold it opens with for `metric` (the group rule's, else the declared or default pass threshold). */
  threshold: number;
}

/**
 * `passesMetrics` are the metrics the passes response lists; before it arrives the row's own metrics stand in (the two
 * agree for every run the platform stores).
 */
export function groupChoiceFor(
  row: RunRow,
  remembered: string | null,
  metricTypes: Record<string, MetricType>,
  passesMetrics?: string[],
): GroupChoice {
  const scoreMetrics = (passesMetrics ?? row.metrics).filter((m) => metricTypes[m] !== 'numeric');
  const metric = resolveMetric(
    remembered,
    scoreMetrics,
    defaultMetricName(scoreMetrics, row.metric_specs) ?? null,
  );
  const rule = metric ? groupStatRule([toChartRun(row)], metric) : null;
  const direction = metricDirection(row.metric_specs[metric ?? '']);
  // A finished run's summary holds the group set at the server's default threshold: open on it, so no request is made
  const projected = metric ? row.pass_groups?.[metric]?.threshold : undefined;
  const threshold =
    projected ??
    rule?.threshold ??
    defaultPassThreshold(metric ? row.metric_specs[metric] : undefined, direction);
  return { scoreMetrics, metric, direction, threshold };
}

/** The group set the summary holds for `metric` at `threshold`, or null when the strip must ask the server. */
export function projectedGroup(row: RunRow, metric: string | null, threshold: number): GroupMetrics['group'] {
  const stored = metric ? row.pass_groups?.[metric] : undefined;
  return stored && Math.abs(stored.threshold - threshold) < 1e-9 ? (stored.group ?? null) : null;
}

/**
 * A finished run's pass rows from its published summary, in the shape of the /passes response, or undefined when the
 * summary has none (a live run, or a summary published before shape 6): then the list asks /passes.
 */
export function summaryPasses(row: RunRow): RunPasses | undefined {
  const details = row.pass_details;
  if (!details?.length || !row.pass_summaries?.length) return undefined;
  const byNumber = new Map(details.map((d) => [d.pass_number, d]));
  return {
    run_id: row.run_id,
    samples: row.samples,
    pass_revision: row.pass_revision,
    metrics: row.metrics,
    passes: row.pass_summaries.map((s) => ({
      ...s,
      ...(byNumber.get(s.pass_number) ?? {
        metric_means: {},
        items_scored: 0,
        items_total: row.total_items,
        completed_count: 0,
        avg_latency_ms: null,
        median_latency_ms: null,
        p95_latency_ms: null,
        started_at: null,
        ended_at: null,
        duration_ms: null,
        trace_stats: null,
      }),
    })),
  };
}
