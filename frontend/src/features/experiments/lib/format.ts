/** Small display helpers for experiments and jobs (pure, no React). */
import type { BaseSource, Experiment, ExperimentJob } from '@/api/experiments';

export function titleCase(status: string | null | undefined): string {
  const text = String(status ?? '')
    .toLowerCase()
    .replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function relTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return '—';
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function absTime(value: string | null | undefined): string {
  if (!value) return '';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleString();
}

const BASE_LABELS: Record<string, string> = {
  official: 'Default preset',
  best_run: 'Best run',
  saved: 'Saved preset',
  blank: 'Blank',
  clone: 'Clone',
};

export function baseSourceLabel(base: BaseSource | null | undefined): string {
  const kind = base?.kind;
  return (kind && BASE_LABELS[kind]) || (kind ? titleCase(kind) : 'Blank');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Headline metric / tick value: 3 decimals, fewer digits for large numbers. */
export function formatMetric(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  return value.toFixed(3);
}

/** A swept / bound value as short text (models read as their name, not as JSON). */
export function formatParam(value: unknown): string {
  if (value === null || value === undefined) return 'inherit';
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown>;
  const temporary = v.temporary as Record<string, unknown> | undefined;
  if (temporary && typeof temporary === 'object')
    return String(temporary.model || temporary.label || 'temporary');
  if (v.connection_id) return String(v.model || v.name || v.connection_id);
  if (v.inherit === true) return 'inherit';
  try {
    return JSON.stringify(value);
  } catch {
    return '?';
  }
}

/** `k=v, k=v` for a job's params (objects as JSON). */
export function paramsSummary(params: ExperimentJob['params'] | null | undefined): string {
  if (!params || typeof params !== 'object') return '';
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${key}=${value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(', ');
}

/** The sweep part of a job's params as `label=value` pairs, falling back to the full params. */
export function sweepSummary(job: ExperimentJob, labels: Record<string, string> = {}): string {
  const sweep = job.params?.sweep;
  if (sweep && typeof sweep === 'object' && Object.keys(sweep).length) {
    return Object.entries(sweep)
      .map(
        ([pointer, value]) =>
          `${labels[pointer] ?? pointer.split('/').pop() ?? pointer}=${formatParam(value)}`,
      )
      .join(', ');
  }
  return job.combo_label || '';
}

export interface JobTally {
  ok: number;
  failed: number;
  live: number;
  cancelled: number;
}

/** ok / failed / live / cancelled from the experiment's `job_counts`. */
export function tallyJobCounts(counts: Experiment['job_counts'] | null | undefined): JobTally {
  const tally: JobTally = { ok: 0, failed: 0, live: 0, cancelled: 0 };
  for (const [status, raw] of Object.entries(counts ?? {})) {
    const n = Number(raw) || 0;
    if (status === 'SUCCEEDED') tally.ok += n;
    else if (status === 'FAILED' || status === 'TIMED_OUT') tally.failed += n;
    else if (status === 'CANCELLED') tally.cancelled += n;
    else tally.live += n;
  }
  return tally;
}
