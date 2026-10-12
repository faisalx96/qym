/** Overview trend scale and number formats (ported from overview.html trendIsRate / trendFormat). */

/** A metric whose daily means all sit in 0..1 is a rate and reads as a percentage. */
export function trendIsRate(values: (number | null | undefined)[]): boolean {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  return finite.every((v) => v >= 0 && v <= 1);
}

export function trendFormat(value: number | null | undefined, rate: boolean): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (rate) return `${(value * 100).toFixed(1)}%`;
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(3);
}

export function trendFormatDelta(delta: number | null | undefined, rate: boolean): string {
  if (delta == null || !Number.isFinite(delta)) return '';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const abs = Math.abs(delta);
  return sign + (rate ? `${(abs * 100).toFixed(1)} pts` : trendFormat(abs, false));
}

/**
 * The Y domain fits the values (padded) so a few points of change stay visible;
 * a rate snaps to whole 5% steps inside 0..1.
 */
export function trendDomain(values: (number | null | undefined)[], rate: boolean): [number, number] {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  const spread = Math.max(high - low, rate ? 0.1 : Math.abs(high) * 0.1 || 1);
  low -= spread * 0.25;
  high += spread * 0.25;
  if (rate) {
    low = Math.max(0, Math.floor(low * 20) / 20);
    high = Math.min(1, Math.ceil(high * 20) / 20);
  }
  return [low, high];
}
