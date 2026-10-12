/** Small admin formatters (relative time, bytes, owner/project labels). */
import type { AdminRunSummary } from '@/api/admin';

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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
  return n === null || n === undefined ? '—' : n.toLocaleString();
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
