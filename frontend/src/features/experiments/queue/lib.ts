/** Pure queue logic: the split-cancel partition, labels and outcome summaries (brief 06 §2.8). */
import { QUEUED_HERE, type QueueJob, type RemoteItem } from '@/api/evalQueue';

export const CONTROL_HINT = 'Only the experiment’s creator or a project manager can cancel its jobs';

export interface JobSplit {
  /** Queued or blocked here: removed immediately, nothing reaches the service. */
  here: QueueJob[];
  /** Submitted or running on the service: hard-stopped there. */
  remote: QueueJob[];
  /** Not allowed, or already stopping: left alone. */
  skipped: QueueJob[];
}

export function isCancellable(job: QueueJob): boolean {
  return job.can_cancel && job.status !== 'CANCELLING';
}

export function splitJobs(jobs: QueueJob[]): JobSplit {
  const split: JobSplit = { here: [], remote: [], skipped: [] };
  for (const job of jobs) {
    if (!isCancellable(job)) split.skipped.push(job);
    else if ((QUEUED_HERE as string[]).includes(job.status)) split.here.push(job);
    else split.remote.push(job);
  }
  return split;
}

export function jobLabel(job: QueueJob): string {
  return `${job.experiment_name || 'Experiment'} #${job.combo_index} on ${job.environment_name || 'an environment'}`;
}

export interface SplitSection {
  key: 'here' | 'remote' | 'skipped' | 'orphans' | 'stale';
  title: string;
  body: string;
  items: string[];
  skip?: boolean;
}

export function jobSections(split: JobSplit): SplitSection[] {
  const all: SplitSection[] = [
    {
      key: 'here',
      title: 'Queued here (not yet sent)',
      body: 'Removed immediately; nothing reaches the Evaluation Service.',
      items: split.here.map(jobLabel),
    },
    {
      key: 'remote',
      title: 'Submitted or running on the service',
      body: 'Will be hard-stopped; partial results stay on the linked run.',
      items: split.remote.map(jobLabel),
    },
    {
      key: 'skipped',
      title: 'Not allowed (skipped)',
      body: `${CONTROL_HINT}, and jobs already stopping are left alone.`,
      items: split.skipped.map(jobLabel),
      skip: true,
    },
  ];
  return all.filter((s) => s.items.length > 0);
}

export function remoteSections(items: RemoteItem[], ids: string[]): SplitSection[] {
  const byId = new Map(items.map((i) => [i.remote_job_id, i]));
  const stale = ids.filter((id) => byId.get(id)?.stale);
  const orphans = ids.filter((id) => !byId.get(id)?.stale);
  const sections: SplitSection[] = [];
  if (orphans.length)
    sections.push({
      key: 'orphans',
      title: 'Orphans on the service',
      body: 'Match no job of this project. Will be hard-stopped on the service.',
      items: orphans,
    });
  if (stale.length)
    sections.push({
      key: 'stale',
      title: 'Stale jobs on the service',
      body: 'Their qym job already finished, but the service still runs them. Will be hard-stopped on the service.',
      items: stale.map((id) => {
        const match = byId.get(id)?.match;
        return `${id} (${match?.experiment_name ?? 'experiment'}, ${titleCase(match?.status ?? '')})`;
      }),
    });
  return sections;
}

export function titleCase(value: string): string {
  const v = String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Toast text for a `/eval-queue/cancel` result (`counts` of outcomes). */
export function outcomeSummary(counts: Record<string, number> | undefined): string {
  const c = counts ?? {};
  const parts: string[] = [];
  if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
  if (c.cancelling) parts.push(`${c.cancelling} stopping on the service`);
  if (c.already_terminal) parts.push(`${c.already_terminal} already finished`);
  if (c.forbidden) parts.push(`${c.forbidden} not allowed`);
  if (c.not_found) parts.push(`${c.not_found} not found`);
  return parts.join(', ') || 'Nothing to cancel';
}

/** `k=v, …` summary of a job's params for the experiment sub-line. */
export function paramsSummary(params: Record<string, unknown> | null | undefined): string {
  if (!params) return '';
  const sweep = (params as { sweep?: Record<string, unknown> }).sweep;
  const source = sweep && typeof sweep === 'object' && Object.keys(sweep).length ? sweep : null;
  if (!source) return '';
  return Object.entries(source)
    .map(
      ([k, v]) =>
        `${k.split('/').filter(Boolean).slice(-1)[0] ?? k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    )
    .join(', ');
}

/** Elapsed seconds since the run started (or the job was submitted); null while queued/blocked. */
export function elapsedSeconds(job: QueueJob, now: number): number | null {
  if (job.status === 'QUEUED' || job.status === 'BLOCKED') return null;
  const since = job.run?.started_at ?? job.submitted_at;
  if (!since) return null;
  const ms = now - new Date(since).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

export function formatElapsed(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 0..1 progress of a linked run, or null when the total is unknown. */
export function runProgress(job: QueueJob): number | null {
  const run = job.run;
  if (!run || !run.items_total) return null;
  return Math.min(1, Math.max(0, (run.items_done ?? 0) / run.items_total));
}
