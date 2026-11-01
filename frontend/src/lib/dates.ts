/**
 * The one set of date formats (C048), in the one app locale (C050):
 *   tables     'Sep 14 · 19:05'        (the year joins when it is not this year: 'Sep 14, 2025 · 19:05')
 *   headers    'Sep 14, 2026, 19:05'
 *   a day      'Sep 14, 2026'           (a date with no time of day, such as Created or Granted)
 *   freshness  '5m ago'                 ('just now', '3h ago', '2d ago'; older than 30 days falls back to a day)
 * Times are 24-hour. Every page formats dates through this module.
 */

/** The app renders in one locale; every Intl and toLocale* call passes it. */
export const APP_LOCALE = 'en-US';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Parse an ISO string. A timestamp with a time but no zone is the server's UTC. Invalid or empty gives null. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  const iso = /T\d\d:\d\d/.test(value) && !/(Z|[+-]\d\d:?\d\d)$/.test(value) ? `${value}Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '19:05' */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** 'Sep 14' (with ', 2025' when not this year). */
export function formatShortDay(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''}`;
}

/** Table cells: 'Sep 14 · 19:05'. */
export function formatTableDate(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  return d ? `${formatShortDay(d, now)} · ${formatTime(d)}` : '—';
}

/** Headers and tooltips: 'Sep 14, 2026, 19:05'. */
export function formatHeaderDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${formatTime(d)}` : '—';
}

/** A date with no time of day: 'Sep 14, 2026'. */
export function formatDay(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—';
}

/** Freshness: 'just now', '5m ago', '3h ago', '2d ago'; past 30 days the day itself. */
export function formatAgo(
  value: string | number | Date | null | undefined,
  now: number | Date = Date.now(),
): string {
  const d = toDate(value);
  if (!d) return '—';
  const s = Math.max(0, Math.round(((typeof now === 'number' ? now : now.getTime()) - d.getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  const days = Math.round(s / 86_400);
  return days <= 30 ? `${days}d ago` : formatDay(d);
}
