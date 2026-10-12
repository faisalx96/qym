import type { Row } from '../types';

export interface LatencySummary {
  count: number;
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

/** Linear-interpolation percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (rank - lo);
}

/** Latency of completed rows; null/0 latencies are "unknown" and left out. */
export function latencySummary(rows: Row[]): LatencySummary | null {
  const values = rows
    .filter((r) => r.status === 'completed' && typeof r.latency_ms === 'number' && r.latency_ms > 0)
    .map((r) => r.latency_ms as number)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  return {
    count: values.length,
    min: values[0] ?? 0,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
    max: values[values.length - 1] ?? 0,
  };
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
