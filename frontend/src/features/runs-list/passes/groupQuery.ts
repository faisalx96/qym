/**
 * Which metric and threshold the passes strip of a run opens with, from the run row alone. The strip and the page's
 * background prefetch both ask this one function, so the group-metrics request a prefetch warms is the request the
 * strip makes when the group is opened (same query key, round 7 Q2.3).
 */
import type { MetricType, RunRow } from '@/api/dashboardTypes';
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
  const threshold =
    rule?.threshold ?? defaultPassThreshold(metric ? row.metric_specs[metric] : undefined, direction);
  return { scoreMetrics, metric, direction, threshold };
}

/** The group-metrics request of a freshly opened strip, or null for a run with no score metric. */
export function groupQueryFor(
  row: RunRow,
  remembered: string | null,
  metricTypes: Record<string, MetricType>,
): { metric: string; threshold: number } | null {
  const { metric, threshold } = groupChoiceFor(row, remembered, metricTypes);
  return metric ? { metric, threshold } : null;
}
