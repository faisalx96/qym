/**
 * Y axis of the "Performance across attempts" curve (cv4 C1-7). The axis fits the data: the lowest and highest value
 * of every shown series (their confidence band included), plus a margin above and below, snapped outward to clean tick
 * values and clamped to the score range. Curves that span most of 0 to 100% keep the full range in fifths; curves that
 * stay in a narrow band (all between 70 and 80%) get an axis on that band, so a small change does not look flat.
 */

export interface CurveAxis {
  domain: [number, number];
  ticks: number[];
}

/** Clean steps: 1, 2 and 5 times a power of ten. */
const MANTISSAS = [1, 2, 5];

/** Fewest and most intervals between ticks. */
const MIN_INTERVALS = 2;
const MAX_INTERVALS = 5;

const round = (v: number) => Math.round(v * 1e9) / 1e9;

/** The smallest clean step that covers [lo, hi] in at most MAX_INTERVALS steps. */
export function niceStep(lo: number, hi: number): number {
  const span = Math.max(hi - lo, Number.EPSILON);
  let exp = Math.floor(Math.log10(span / MAX_INTERVALS)) - 1;
  for (;;) {
    for (const m of MANTISSAS) {
      const step = m * 10 ** exp;
      if (Math.ceil(round(hi / step)) - Math.floor(round(lo / step)) <= MAX_INTERVALS) return round(step);
    }
    exp += 1;
  }
}

/**
 * The axis for `values`. `range` clamps it (a score is [0, 1]; null for a raw number). `minSpan` is the smallest
 * band the axis may show (2 points of a score), so one flat value is not blown up to fill the plot. `fullAt` is the
 * share of the range from which the axis shows the full range in fifths (0.6 for the curve; the per-pass box plots
 * use 0.9, so a spread from 37 to 100% still zooms, cv4 Y7).
 */
export function curveAxis(
  values: number[],
  {
    range = [0, 1],
    minSpan = 0.02,
    fullAt = 0.6,
  }: { range?: [number, number] | null; minSpan?: number; fullAt?: number } = {},
): CurveAxis {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) {
    const [a, b] = range ?? [0, 1];
    return { domain: [a, b], ticks: [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => round(a + f * (b - a))) };
  }
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  // a margin of 15% of the span above and below, so no point sits on the frame
  const margin = (hi - lo) * 0.15;
  lo -= margin;
  hi += margin;
  if (range) {
    lo = Math.max(range[0], lo);
    hi = Math.min(range[1], hi);
  }
  // most of the score range: the full range in fifths, as before
  if (range && hi - lo >= (range[1] - range[0]) * fullAt) {
    const [a, b] = range;
    return { domain: [a, b], ticks: [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => round(a + f * (b - a))) };
  }
  const step = niceStep(lo, hi);
  let start = round(Math.floor(round(lo / step)) * step);
  let end = round(Math.ceil(round(hi / step)) * step);
  // at least MIN_INTERVALS ticks apart, grown on the side with room
  while (round((end - start) / step) < MIN_INTERVALS) {
    if (!range || end + step <= range[1]) end = round(end + step);
    else start = round(start - step);
  }
  if (range) {
    start = Math.max(range[0], start);
    end = Math.min(range[1], end);
  }
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 1e6; t = round(t + step)) ticks.push(t);
  return { domain: [start, end], ticks };
}

/** A tick label for a score axis: whole percents, one decimal when the step is below 1 point. */
export function percentTick(value: number, ticks: number[]): string {
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const digits = step < 0.01 - 1e-9 ? 1 : 0;
  return `${(value * 100).toFixed(digits)}%`;
}
