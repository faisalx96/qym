/** Distribution summary behind every box plot (round 3 P7): quartiles, whiskers at p5 / p95, capped outlier lists. */
import { quantile } from './latencyModel';

/** Outlier dots drawn per side (the true min and max are always among them). */
export const MAX_DOTS_PER_SIDE = 40;
/** Below this many values p5 and p95 are not meaningful: whiskers are min and max and no dots are drawn. */
export const MIN_FOR_PERCENTILES = 20;

export interface BoxStats {
  n: number;
  min: number;
  p5: number;
  p25: number;
  median: number;
  mean: number;
  p75: number;
  p95: number;
  max: number;
  sum: number;
  /** Values strictly below p5, ascending, at most 40 (decimated, min kept). */
  low: number[];
  /** Values strictly above p95, ascending, at most 40 (decimated, max kept). */
  high: number[];
  /** How many values each side really holds before decimation. */
  lowCount: number;
  highCount: number;
  /** p5 and p95 are real percentiles (20 or more values). */
  percentiles: boolean;
}

/** Evenly spaced `limit` entries of an ascending list that always keep the first and the last. */
export function decimate(sorted: number[], limit = MAX_DOTS_PER_SIDE): number[] {
  if (sorted.length <= limit) return sorted;
  const out: number[] = [];
  for (let i = 0; i < limit; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (limit - 1))]!);
  return out;
}

const EMPTY: BoxStats = {
  n: 0,
  min: NaN,
  p5: NaN,
  p25: NaN,
  median: NaN,
  mean: NaN,
  p75: NaN,
  p95: NaN,
  max: NaN,
  sum: 0,
  low: [],
  high: [],
  lowCount: 0,
  highCount: 0,
  percentiles: false,
};

/** Summary of a list of values (unsorted, finite numbers only). One sort of a Float64Array, one pass for sum and mean. */
export function boxStats(values: number[]): BoxStats {
  const finite = values.filter((v) => Number.isFinite(v));
  const n = finite.length;
  if (!n) return EMPTY;
  const v = Float64Array.from(finite).sort();
  const sorted = Array.from(v);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i]!;
  const percentiles = n >= MIN_FOR_PERCENTILES;
  const p5 = percentiles ? quantile(sorted, 0.05) : sorted[0]!;
  const p95 = percentiles ? quantile(sorted, 0.95) : sorted[n - 1]!;
  const lowAll = percentiles ? sorted.filter((x) => x < p5) : [];
  const highAll = percentiles ? sorted.filter((x) => x > p95) : [];
  return {
    n,
    min: sorted[0]!,
    p5,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    mean: sum / n,
    p75: quantile(sorted, 0.75),
    p95,
    max: sorted[n - 1]!,
    sum,
    low: decimate(lowAll),
    high: decimate(highAll),
    lowCount: lowAll.length,
    highCount: highAll.length,
    percentiles,
  };
}

/** A total is shown for additive quantities only: never with a negative value, and the caller decides the kind. */
export function hasNegative(values: number[]): boolean {
  return values.some((v) => v < 0);
}
