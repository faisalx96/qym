/** Axis of a box plot (round 3 P7): linear, from 0 for non-negative data, nice ticks, clipped when the tail is far out. */
import type { BoxStats } from './boxStats';

export interface BoxAxis {
  domain: [number, number];
  ticks: number[];
  /** The axis stops at 1.15 x p95 and the points beyond it collapse into one arrow at the right edge. */
  clipped: boolean;
  /** Values beyond the clip (empty when not clipped). */
  beyond: number;
}

/** Nice step (1, 2, 2.5, 5 x 10^k) that covers `span` in at most `maxTicks - 1` steps. */
export function niceStepFor(span: number, maxTicks: number): number {
  const raw = Math.max(span, 1e-12) / Math.max(1, maxTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12) ?? 10 * mag;
}

/** `maxTicks` is 5, or 3 under 320px of plot width. */
export function boxAxis(
  stats: BoxStats,
  opts: { maxTicks?: number; fixed?: [number, number]; values?: number[] } = {},
): BoxAxis {
  const maxTicks = opts.maxTicks ?? 5;
  if (opts.fixed) {
    const [lo, hi] = opts.fixed;
    const step = (hi - lo) / Math.max(1, maxTicks - 1);
    return {
      domain: [lo, hi],
      ticks: Array.from({ length: maxTicks }, (_, i) => lo + step * i),
      clipped: false,
      beyond: 0,
    };
  }
  const clipped = stats.percentiles && stats.p95 > 0 && stats.max > 4 * stats.p95;
  const top = clipped ? stats.p95 * 1.15 : stats.max;
  const bottom = stats.min < 0 ? stats.min : 0;
  const step = niceStepFor(top - bottom, maxTicks);
  const lo = bottom < 0 ? Math.floor(bottom / step) * step : 0;
  const hi = Math.max(step, Math.ceil(top / step) * step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step * 1e-6; t += step) ticks.push(Number(t.toPrecision(12)));
  const beyond = clipped ? (opts.values ?? stats.high).filter((x) => x > hi).length : 0;
  return { domain: [lo, hi], ticks, clipped, beyond };
}

/** Position of a value on the axis (0..1, clamped). */
export function axisPosition(value: number, domain: [number, number]): number {
  const span = domain[1] - domain[0] || 1;
  return Math.min(1, Math.max(0, (value - domain[0]) / span));
}
