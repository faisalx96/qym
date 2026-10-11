/** How one run's row reads on the page: metric cell text, pass/fail, error kind (run-detail rowDisplay, per compare run). */
import {
  formatMetricObservation,
  formatPercent,
  getRowScore,
  isItemTaskError,
  rowMetricPasses,
  type MetricDirection,
  type MetricType,
} from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import type { CompareModel, CompareRun } from './model';
import type { MetricCtx } from './scoring';

export interface MetricCellView {
  metric: string;
  value: number | null;
  text: string;
  type: MetricType;
  direction: MetricDirection;
  error: 'task' | 'metric' | null;
  edited: boolean;
}

export function metricCellFor(model: CompareModel, run: CompareRun, row: Row, metric: string): MetricCellView {
  const idx = run.metricIndex[metric];
  const type = model.types[metric] ?? 'score';
  const direction = model.directions[metric] ?? null;
  const { score, isError } = idx === undefined ? { score: null, isError: false } : getRowScore(row, idx, metric, direction);
  const meta = row.metric_meta?.[metric] as Record<string, unknown> | undefined;
  const edited = !!meta && String(meta.modified ?? '').toLowerCase() === 'true';
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
          ? formatMetricObservation(score, type, model.specs[metric])
          : formatPercent(score, 1);
  }
  return { metric, value: score, text, type, direction, error: isError ? (isItemTaskError(row) ? 'task' : 'metric') : null, edited };
}

export type PillState = 'pass' | 'fail' | 'error' | 'none';

export function pillState(run: CompareRun, row: Row | null, ctx: MetricCtx): { state: PillState; score: number | null } {
  if (!row || run.metricIndex[ctx.metric] === undefined) return { state: 'none', score: null };
  const outcome = getRowScore(row, run.metricIndex[ctx.metric] as number, ctx.metric, ctx.direction);
  if (outcome.isError && (ctx.direction === 'minimize' || outcome.score === null || isItemTaskError(row))) {
    return { state: 'error', score: outcome.score };
  }
  if (outcome.score === null) return { state: 'none', score: null };
  const passed = rowMetricPasses(outcome, ctx.threshold, ctx.direction, ctx.isBoolean);
  return { state: passed === null ? 'none' : passed ? 'pass' : 'fail', score: outcome.score };
}

/** Archived project: no edit controls. A submitted/approved run keeps its scores as reviewed. */
export const runReadOnly = (run: CompareRun) => !!run.run.project?.archived;
export const runScoresLocked = (run: CompareRun) => ['SUBMITTED', 'APPROVED'].includes(String(run.run.status).toUpperCase());
