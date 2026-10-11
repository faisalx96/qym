/** Number/time formatting ported from metrics.js and dashboard.js. */

export function formatLatency(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms >= 60_000) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms)) || Number(ms) < 0) return '—';
  const total = Number(ms);
  if (total < 1000) return `${Math.round(total)}ms`;
  if (total < 60_000) return `${(total / 1000).toFixed(total >= 10_000 ? 0 : 1)}s`;
  const totalSeconds = Math.round(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 11" + "19:16" split for the Date cell. */
export function formatDateParts(iso: string | null | undefined): { date: string; time: string; full: string } {
  if (!iso) return { date: '—', time: '', full: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '', full: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''}`;
  return {
    date,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    full: d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
  };
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "YYYY-MM-DD" of a local date. */
export function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
