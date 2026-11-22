/** The words and the status mark of a factory job, shared by the attempts table and the attempt page. */
import type { FactoryJob, FactoryJobStatus } from '@/api/factory';
import { APP_LOCALE } from '@/lib/dates';
import { StatusMark, type StatusShape, type StatusTone } from '@/ui';

const MARK: Record<FactoryJobStatus, { tone: StatusTone; shape: StatusShape }> = {
  queued: { tone: 'neutral', shape: 'ring' },
  running: { tone: 'info', shape: 'orbit' },
  cancel_requested: { tone: 'warning', shape: 'pause' },
  succeeded: { tone: 'success', shape: 'full' },
  failed: { tone: 'danger', shape: 'cross' },
  cancelled: { tone: 'neutral', shape: 'pause' },
};
const LABEL: Record<FactoryJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  cancel_requested: 'Stopping',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function JobStatusMark({ job }: { job: FactoryJob }) {
  return <StatusMark tone={MARK[job.status].tone} shape={MARK[job.status].shape} label={LABEL[job.status]} data-status={job.status} />;
}

export function progressText(job: FactoryJob): string {
  const p = job.progress;
  if (job.kind === 'generation' && typeof p.generated === 'number') {
    const cap = typeof p.max_items === 'number' ? ` of at most ${p.max_items.toLocaleString(APP_LOCALE)}` : '';
    const layer =
      typeof p.layer === 'number' && typeof p.layers === 'number' && p.layer > 0 ? ` · layer ${p.layer} of ${p.layers}` : '';
    return `${p.generated.toLocaleString(APP_LOCALE)} item${p.generated === 1 ? '' : 's'}${cap}${layer}`;
  }
  if (job.kind === 'analysis' && typeof p.rules_added === 'number') {
    const done = typeof p.done === 'number' && typeof p.total === 'number' ? ` · ${p.done} of ${p.total} calls` : '';
    return `${p.rules_added} rule${p.rules_added === 1 ? '' : 's'} added${done}`;
  }
  return String(p.message ?? '');
}

export function paramsText(job: FactoryJob): string {
  const p = job.params;
  if (job.kind !== 'generation') return 'Rule analysis';
  const parts = [`${p.max_layers ?? 1} layer${p.max_layers === 1 ? '' : 's'}`, `${p.branching ?? 1} per item`];
  if (p.official_only === false) parts.push('proposed rules too');
  return parts.join(' · ');
}

export function reviewText(job: FactoryJob): string | null {
  if (job.kind !== 'generation' || !job.review || job.review.total === 0) return null;
  const r = job.review;
  const f = (v: number) => v.toLocaleString(APP_LOCALE);
  return `${f(r.approved)} approved · ${f(r.rejected)} rejected · ${f(r.pending)} pending`;
}
