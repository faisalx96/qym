/** Small admin formatters (relative time, bytes, owner/project labels). */
import type { AdminRunSummary } from '@/api/admin';
import { APP_LOCALE, formatAgo, formatHeaderDate } from '@/lib/dates';

/** Freshness, then the day (lib/dates, C048). */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  return formatAgo(iso, now);
}

/** Header form 'Sep 14, 2026, 19:05' (lib/dates, C048). */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? formatHeaderDate(iso) : '—';
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString(APP_LOCALE);
}

export function runName(run: AdminRunSummary): string {
  return run.run_name || run.external_run_id || run.run_id.slice(0, 8);
}

export function ownerLabel(run: AdminRunSummary): string {
  const o = run.owner;
  return o?.display_name || (o?.email ?? '').split('@')[0] || o?.id || '—';
}

export function projectLabel(run: AdminRunSummary): string {
  const p = run.project;
  return p?.name || p?.slug || p?.id || '—';
}

export function progressLabel(run: AdminRunSummary, variant: 'live' | 'recent' = 'recent'): string {
  const done = run.progress_completed ?? 0;
  const total =
    variant === 'live' ? (run.progress_total ?? run.total_items) : (run.total_items ?? run.progress_total);
  if (total) return `${done}/${total}`;
  return done ? String(done) : '—';
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$|^[^\s@]+@localhost$|^[^\s@]+@local$/.test(value.trim());
}
