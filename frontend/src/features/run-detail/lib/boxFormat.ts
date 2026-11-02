/** Value formatters of the box plot cards (round 3 P7): one rule per quantity kind. */
import { formatNumericValue, formatPercent } from '@/lib/metrics';
import { durText, tickLabel } from './latencyModel';

export type BoxKind = 'numeric' | 'latency' | 'percent' | 'tokens' | 'cost';

export function formatCost(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return `$${v.toFixed(0)}`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  if (a >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

export function boxFormatter(kind: BoxKind): (v: number) => string {
  switch (kind) {
    case 'latency':
      return (v) => (v === 0 ? '0ms' : durText(v));
    case 'percent':
      return (v) => formatPercent(v, 1);
    case 'cost':
      return formatCost;
    case 'tokens':
      return (v) => formatNumericValue(v, 0);
    default:
      return (v) => formatNumericValue(v);
  }
}

/** Tick labels drop decimals the axis does not need. */
export function boxTickFormatter(kind: BoxKind): (v: number) => string {
  if (kind === 'percent') return (v) => `${Math.round(v * 100)}%`;
  if (kind === 'latency') return tickLabel;
  return boxFormatter(kind);
}

/** Total is a number for additive quantities only: numeric metrics, tokens and cost, and never with a negative value. */
export function showsTotal(kind: BoxKind, negative: boolean): boolean {
  return !negative && (kind === 'numeric' || kind === 'tokens' || kind === 'cost');
}

/** The formatted total of an additive quantity, or undefined (latency, scores, percentages, negative values, no values). */
export function boxTotalText(values: number[], kind: BoxKind): string | undefined {
  if (!values.length || values.some((v) => v < 0) || !showsTotal(kind, false)) return undefined;
  return boxFormatter(kind)(values.reduce((a, v) => a + v, 0));
}
