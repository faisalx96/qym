/** The metrics matrix of an expanded item (round 3 P5): row order, the default 8 rows, the mean, "differs across passes". */

/** Rows shown before "Show N more metrics". */
export const DEFAULT_METRIC_ROWS = 8;

/** The analysis metric first, the rest in run order. */
export function orderMetrics(metricNames: string[], analysisMetric: string | null): string[] {
  if (!analysisMetric || !metricNames.includes(analysisMetric)) return [...metricNames];
  return [analysisMetric, ...metricNames.filter((m) => m !== analysisMetric)];
}

export function limitRows<T>(rows: T[], expanded: boolean, limit = DEFAULT_METRIC_ROWS): T[] {
  return expanded ? rows : rows.slice(0, limit);
}

/** Mean of the numeric values; null when there are none. */
export function meanOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** True when the metric did not score the same in every pass that has a value. */
export function differsAcrossPasses(values: Array<number | null>): boolean {
  const nums = values.filter((v): v is number => typeof v === 'number');
  return nums.length > 1 && nums.some((v) => v !== nums[0]);
}

/** "8 shown of 24 · 3 below threshold" (one pass) or "8 shown of 24 · 1 metric differs across passes". */
export function matrixSummary(args: {
  shown: number;
  total: number;
  passes: number;
  belowThreshold: number;
  differing: number;
}): string {
  const base = `${args.shown} shown of ${args.total}`;
  if (args.passes > 1) {
    return `${base} · ${args.differing} ${args.differing === 1 ? 'metric differs' : 'metrics differ'} across passes`;
  }
  return `${base} · ${args.belowThreshold} below threshold`;
}
