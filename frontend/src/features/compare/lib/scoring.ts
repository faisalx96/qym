/** Per-metric scoring context shared by stats, baseline and cohort math. */
import {
  bestMetricIndexes,
  getRowScore,
  isErrorRow,
  rowMetricPasses,
  type MetricDirection,
  type RowScore,
} from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import type { CompareModel, CompareRun } from './model';

export interface MetricCtx {
  metric: string;
  direction: MetricDirection;
  threshold: number;
  isBoolean: boolean;
}

export function metricCtx(
  model: CompareModel,
  metric: string,
  thresholds: Record<string, number> = {},
): MetricCtx {
  return {
    metric,
    direction: model.directions[metric] ?? null,
    threshold: thresholds[metric] ?? model.defaultThresholds[metric] ?? 0.8,
    isBoolean: !!model.isBoolean[metric],
  };
}

function computeOutcome(run: CompareRun, itemId: string, ctx: MetricCtx): RowScore | null {
  const row = run.byItem.get(itemId);
  const idx = run.metricIndex[ctx.metric];
  if (!row || idx === undefined) return null;
  return getRowScore(row, idx, ctx.metric, ctx.direction);
}

/**
 * Outcome of every (run, item) on a metric, computed once per model + metric +
 * direction: stats, columns, filters and cohorts all read the same matrix
 * (20 runs x 2000 items is ~40k getRowScore calls; the matrix keeps a filter
 * change at a few ms). The pass threshold is not part of it (verdicts are cheap).
 */
const matrices = new WeakMap<CompareModel, Map<string, Map<string, RowScore | null>[]>>();

function matrixFor(model: CompareModel, ctx: MetricCtx): Map<string, RowScore | null>[] {
  let byKey = matrices.get(model);
  if (!byKey) {
    byKey = new Map();
    matrices.set(model, byKey);
  }
  const key = `${ctx.metric}|${ctx.direction ?? ''}`;
  let matrix = byKey.get(key);
  if (!matrix) {
    matrix = model.runs.map((run) => {
      const m = new Map<string, RowScore | null>();
      for (const id of run.byItem.keys()) m.set(id, computeOutcome(run, id, ctx));
      return m;
    });
    byKey.set(key, matrix);
  }
  return matrix;
}

/** The row's outcome on the metric, or null when the run has no row or no such metric. */
export function runOutcome(
  run: CompareRun,
  itemId: string,
  ctx: MetricCtx,
  model?: CompareModel,
): RowScore | null {
  if (model) return matrixFor(model, ctx)[run.position]?.get(itemId) ?? null;
  return computeOutcome(run, itemId, ctx);
}

/** Pass/fail of an outcome; undefined = no verdict (no score, no error). */
export function verdictOf(outcome: RowScore | null, ctx: MetricCtx): boolean | undefined {
  if (!outcome || (outcome.score === null && !outcome.isError)) return undefined;
  return rowMetricPasses(outcome, ctx.threshold, ctx.direction, ctx.isBoolean) === true;
}

export interface ItemOutcomes {
  scores: Array<number | null>;
  outcomes: Array<RowScore | null>;
  /** undefined = this run has no verdict on the item. */
  verdicts: Array<boolean | undefined>;
  rows: Array<Row | null>;
}

export function itemOutcomes(model: CompareModel, itemId: string, ctx: MetricCtx): ItemOutcomes {
  const rows = model.runs.map((r) => r.byItem.get(itemId) ?? null);
  const matrix = matrixFor(model, ctx);
  const outcomes = model.runs.map((r) => matrix[r.position]?.get(itemId) ?? null);
  return {
    rows,
    outcomes,
    scores: outcomes.map((o) => (o ? o.score : null)),
    verdicts: outcomes.map((o) => verdictOf(o, ctx)),
  };
}

export function winnersOf(scores: Array<number | null>, direction: MetricDirection): number[] {
  return bestMetricIndexes(scores, direction);
}

export { isErrorRow };
