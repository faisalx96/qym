/** Number/time formatting ported from metrics.js and dashboard.js. Dates come from lib/dates (C048). */
import { formatAgo, formatHeaderDate, formatShortDay, formatTime, toDate } from './dates';

/**
 * The one duration format (C164): '850ms', '27.2s', '4m 5s', '2h 3m'. No space before a unit; one decimal under a
 * minute. Every duration on every page goes through here.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms)) || Number(ms) < 0) return '—';
  const total = Number(ms);
  if (total < 1000) return `${Math.round(total)}ms`;
  if (total < 60_000) return `${(total / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** A latency: formatDuration, with '—' for no time at all. */
export function formatLatency(ms: number | null | undefined): string {
  return !ms || ms <= 0 ? '—' : formatDuration(ms);
}

/** Alias of formatDuration, kept for its call sites. */
export function formatDurationMs(ms: number | null | undefined): string {
  return formatDuration(ms);
}

export function formatNumericValue(value: number | null | undefined, decimals = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(decimals);
}

export function formatPercentValue(value: number | null | undefined, decimals = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function pickAdaptiveDecimals(
  value: number,
  peerValues: (number | null | undefined)[] | undefined,
  format: (v: number, d: number) => string,
  defaultDecimals: number,
  maxDecimals: number,
): number {
  const peers = (peerValues ?? []).filter(
    (p): p is number => p !== undefined && p !== null && !Number.isNaN(p) && p !== value,
  );
  if (peers.length === 0) return defaultDecimals;
  for (let d = defaultDecimals; d <= maxDecimals; d++) {
    const formatted = format(value, d);
    if (!peers.some((p) => format(p, d) === formatted)) return d;
  }
  return maxDecimals;
}

/** Smart decimals: add precision only until neighbours stop colliding. */
export function formatMetricValueSmart(
  value: number | null | undefined,
  metricType: string | undefined,
  peerValues?: (number | null | undefined)[],
  defaultDecimals = 1,
  maxDecimals = 3,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (metricType === 'numeric') {
    const d = pickAdaptiveDecimals(
      value,
      peerValues,
      formatNumericValue,
      Number.isInteger(value) ? 0 : defaultDecimals,
      maxDecimals,
    );
    return formatNumericValue(value, d);
  }
  const d = pickAdaptiveDecimals(value, peerValues, formatPercentValue, defaultDecimals, maxDecimals);
  return formatPercentValue(value, d);
}

/** "Oct 11" + "19:16" split for the Date cell; `full` is the header form (lib/dates, C048). */
export function formatDateParts(iso: string | null | undefined): {
  date: string;
  time: string;
  full: string;
} {
  const d = toDate(iso);
  if (!d) return { date: '—', time: '', full: '' };
  return { date: formatShortDay(d), time: formatTime(d), full: formatHeaderDate(d) };
}

/** Freshness ('5m ago'): lib/dates formatAgo. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  return formatAgo(iso, now);
}

/** "YYYY-MM-DD" of a local date. */
export function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A dataset version as the runs list writes it: 'v1' for 'v1', 'V1' or 1; '' when there is none (C248). */
export function datasetVersionLabel(version: string | number | null | undefined): string {
  const v = version === null || version === undefined ? '' : String(version).trim();
  return v ? `v${v.replace(/^v/i, '')}` : '';
}
