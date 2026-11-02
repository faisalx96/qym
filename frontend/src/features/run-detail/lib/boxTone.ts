/** Tone of a box plot (round 5 R2): one colour, one meaning. Pure. */
import { metricBand, type MetricDirection } from '@/lib/metrics';

export type BoxTone = { band: 1 | 2 | 3 | 4 | 5; series?: undefined } | { series: 1; band?: undefined };

/** Series 1: the baseline colour of a single-series plot (latency, tokens, cost, undirected numerics, steps). */
export const SERIES_TONE: BoxTone = { series: 1 };

/**
 * A score metric with a direction takes the band of its median (the verdict colour every other mark uses);
 * anything without a direction (or without a median) takes series 1, which is never good or bad.
 */
export function boxTone(
  median: number | null | undefined,
  type: string | undefined,
  direction: MetricDirection | undefined,
): BoxTone {
  if (median === null || median === undefined || !Number.isFinite(median) || !direction) return SERIES_TONE;
  const band = metricBand(median, type as Parameters<typeof metricBand>[1], direction);
  return band ? { band } : SERIES_TONE;
}
