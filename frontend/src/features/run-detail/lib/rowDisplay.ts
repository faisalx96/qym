/** What one collapsed item row shows: status, per-metric cells, failure reason (brief 04 J6 / §3i, §3n). */
import {
  formatLatency,
  formatMetricObservation,
  formatPercent,
  hasMetricError,
  hasTaskError,
  isItemTaskError,
  isNotReceivedRow,
  isTaskErrorRow,
  metricPasses,
  passThresholdLabel,
  type MetricDirection,
  type MetricType,
} from '@/lib/metrics';
import { rowPassesFor, rowScoreFor, type FilterContext } from './filterRules';
import { pickReason, type PickedReason } from './itemReasons';
import type { Row } from '../types';

export type StatusKind = 'pass' | 'fail' | 'error' | 'not_received' | 'running' | 'pending' | 'done';

export interface RowStatus {
  kind: StatusKind;
  label: string;
  title: string;
}

export function rowStatus(ctx: FilterContext, row: Row, metric: string | null): RowStatus {
  const status = String(row.status ?? '').toLowerCase();
  if (isNotReceivedRow(row)) {
    return {
      kind: 'not_received',
      label: 'Not received',
      title: 'The item’s outcome never reached the platform; it is left out of the means.',
    };
  }
  if (status === 'running')
    return { kind: 'running', label: 'Running', title: 'The item is being processed' };
  if (status === 'pending') return { kind: 'pending', label: 'Pending', title: 'The item has not started' };
  const repeatAggregate = ctx.repeatAggregate;
  const failedPasses = repeatAggregate
    ? (row.pass_attempts ?? []).filter((a) => a && isTaskErrorRow(a)).length
    : 0;
  if (
    isItemTaskError(row) ||
    (repeatAggregate &&
      failedPasses > 0 &&
      hasTaskError(row) &&
      (row.pass_attempts ?? []).every((a) => !a || isTaskErrorRow(a)))
  ) {
    return { kind: 'error', label: 'Error', title: row.error || 'The task failed' };
  }
  if (metric) {
    const idx = ctx.model.metricNames.indexOf(metric);
    const outcome = rowScoreFor(ctx, row, idx, metric);
    const passed = rowPassesFor(ctx, metric, outcome);
    const title = failedPasses ? `${failedPasses} failed pass${failedPasses === 1 ? '' : 'es'}` : '';
    if (outcome.isError && hasMetricError(row, metric))
      return { kind: 'error', label: 'Error', title: `The ${metric} scorer failed` };
    if (passed === true) return { kind: 'pass', label: 'Pass', title: title || `Pass on ${metric}` };
    if (passed === false) return { kind: 'fail', label: 'Fail', title: title || `Fail on ${metric}` };
  }
  return { kind: 'done', label: 'Done', title: '' };
}

export interface MetricCell {
  metric: string;
  value: number | null;
  text: string;
  type: MetricType;
  direction: MetricDirection;
  error: 'task' | 'metric' | null;
  edited: boolean;
}

export function metricCell(ctx: FilterContext, row: Row, metric: string): MetricCell {
  const { model } = ctx;
  const idx = model.metricNames.indexOf(metric);
  const type = model.metricTypes[metric] ?? 'score';
  const direction = model.metricDirections[metric] ?? null;
  const { score, isError } = rowScoreFor(ctx, row, idx, metric);
  const error = isError ? (isItemTaskError(row) ? 'task' : 'metric') : null;
  const spec = model.metricSpecs[metric];
  const meta = row.metric_meta?.[metric];
  const edited = !!meta && String((meta as Record<string, unknown>).modified ?? '').toLowerCase() === 'true';
  let text = '—';
  if (score !== null) {
    text =
      type === 'boolean'
        ? score >= 0.9999
          ? 'True'
          : score <= 0.0001
            ? 'False'
            : formatPercent(score, 0)
        : type === 'numeric'
          ? formatMetricObservation(score, type, spec)
          : formatPercent(score, 1);
  }
  return { metric, value: score, text, type, direction, error, edited };
}

/** The reason line for a failing or errored row of the displayed metric. */
export function rowFailureInput(ctx: FilterContext, row: Row, metric: string) {
  const idx = ctx.model.metricNames.indexOf(metric);
  const outcome = rowScoreFor(ctx, row, idx, metric);
  const direction = ctx.model.metricDirections[metric] ?? null;
  const isBoolean = !!ctx.model.metricIsBoolean[metric];
  const threshold = ctx.thresholds[metric] ?? 0.8;
  const passed = rowPassesFor(ctx, metric, outcome);
  const type = ctx.model.metricTypes[metric] ?? 'score';
  const cell = metricCell(ctx, row, metric);
  const need = direction
    ? isBoolean
      ? direction === 'minimize'
        ? 'False'
        : 'True'
      : passThresholdLabel(threshold, direction)
    : null;
  void metricPasses;
  void type;
  return { passed, outcome, scoreText: cell.value === null ? null : cell.text, needText: need };
}

export type { PickedReason };
export { pickReason };

/** Latency text: a real 0 ms renders as "0ms"; only a missing value is a dash. */
export function latencyLabel(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms === 0 ? '0ms' : formatLatency(ms);
}
