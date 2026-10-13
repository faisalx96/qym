import type { AnalysisJob } from '@/api/analysis';
import { runPath } from '@/app/routes';
import { Badge, Tag, Text } from '@/ui';
import type { PhaseView } from '../useAnalysisPhase';
import s from './blocks.module.css';

const PHASE: Record<string, string> = {
  queued: 'Queued',
  analyzing: 'Analyzing',
  retrying: 'Retrying',
  aggregating: 'Aggregating categories',
  completed: 'Completed',
  failed: 'Failed',
};

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className={s.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`}
    >
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Link to the run page, keeping the analysed sample (`?pass=N`) of a repeat run. */
export function viewRunTo(slug: string, runId: string, pass: number | null | undefined): string {
  return `${runPath(slug, runId)}${pass != null ? `?pass=${pass}` : ''}`;
}

/**
 * Outcome of a finished job (old `_analysisCompletionState`): failures are the largest of the
 * reported error counts and the results carrying an error; "analyzed" is attempted minus failures
 * (the server's `total_analyzed` also counts the failed ones).
 */
export function summarize(job: AnalysisJob) {
  const result = job.result;
  const results = result?.results ?? [];
  const errored = results.filter((r) => String(r?.error ?? '').trim());
  const failed = Math.max(
    count(result?.errors),
    count(result?.total_analysis_failed),
    count(job.progress.errors),
    errored.length,
  );
  const attempted = Math.max(
    count(result?.total_attempted) || count(job.progress.total),
    count(result?.total_analyzed),
    failed,
  );
  const analyzed = Math.max(0, attempted - failed);
  const groups = new Map<string, number>();
  for (const r of errored) {
    const code = String(r.error_code ?? '').trim() || 'analysis_error';
    groups.set(code, (groups.get(code) ?? 0) + 1);
  }
  const cats = result?.categories;
  const categories = Array.isArray(cats)
    ? cats.length
    : cats && typeof cats === 'object'
      ? Object.keys(cats).length
      : 0;
  return {
    attempted,
    analyzed,
    failed,
    groups: [...groups.entries()],
    allFailed: attempted > 0 && failed > 0 && analyzed === 0,
    categories,
    retries: count(result?.retries) || count(job.progress.retries),
  };
}

/** One sentence for the results card and the toast. */
export function outcomeText(sum: ReturnType<typeof summarize>): string {
  const base = `${sum.analyzed} of ${sum.attempted} metric analyses succeeded`;
  return sum.failed ? `${base}, ${sum.failed} failed` : base;
}

/** Short outcome for the action rail ("34 of 34 succeeded"). */
export function shortOutcome(sum: ReturnType<typeof summarize>): string {
  const base = `${sum.analyzed} of ${sum.attempted} succeeded`;
  return sum.failed ? `${base}, ${sum.failed} failed` : base;
}

export function statusLabel(job: AnalysisJob): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' } {
  const sum = summarize(job);
  if (job.status === 'completed') {
    return sum.allFailed
      ? { text: 'Analysis failed', tone: 'danger' }
      : sum.failed
        ? { text: 'Completed with errors', tone: 'warning' }
        : { text: 'Completed', tone: 'success' };
  }
  if (job.status === 'cancelling') return { text: 'Cancelling', tone: 'info' };
  if (job.status === 'cancelled') return { text: 'Cancelled', tone: 'neutral' };
  if (job.status === 'failed') return { text: 'Failed', tone: 'danger' };
  return {
    text: PHASE[job.progress.phase] ?? 'Running',
    tone: job.progress.phase === 'retrying' ? 'warning' : 'info',
  };
}

/**
 * Job card for the results slot: status, progress and counts while it runs, the
 * completion summary (error-code groups, categories) when it is over. The
 * actions (Cancel, View run, Analyze again) live in the action rail.
 */
export function JobCard({ job, phase }: { job: AnalysisJob; phase: PhaseView }) {
  const live = phase.live;
  const sum = summarize(job);
  const note = phase.reconnecting ? 'Reconnecting to the background analysis…' : phase.retryNote;
  const label = statusLabel(job);
  const done = phase.completed;
  const total = phase.total;
  return (
    <div className={s.jobCard} data-status={job.status} role="region" aria-label="Analysis job">
      <div className={s.jobHead}>
        <Badge tone={label.tone} dot>
          {label.text}
        </Badge>
        <Text variant="md" weight={600} as="span" className={s.jobTitle}>
          {live
            ? `Running ${done} / ${total}`
            : job.status === 'completed'
              ? sum.allFailed
                ? 'Analysis failed'
                : sum.failed
                  ? 'Completed with errors'
                  : 'Analysis complete'
              : job.status === 'failed'
                ? 'Analysis failed'
                : 'Analysis cancelled'}
        </Text>
      </div>
      {live ? (
        <>
          <ProgressBar value={done} max={total} label="Analysis progress" />
          <Text variant="sm" tone={note ? 'warning' : 'muted'} as="p" role="status">
            {note ?? `${PHASE[job.progress.phase] ?? 'Working'}…`}
          </Text>
        </>
      ) : null}
      {job.status === 'completed' ? (
        <div className={s.stack}>
          <Text variant="base" tone="secondary" as="p">
            {`${outcomeText(sum)}.`}
          </Text>
          {!sum.allFailed && !job.result?.aggregation_error ? (
            <Text
              variant="base"
              tone="secondary"
              as="p"
            >{`Created ${sum.categories} ${sum.categories === 1 ? 'category' : 'categories'}`}</Text>
          ) : null}
          {sum.retries > 0 ? (
            <Text variant="base" tone="secondary" as="p">{`Timeout retries: ${sum.retries}`}</Text>
          ) : null}
          {sum.failed ? (
            <ul className={s.errorGroups} aria-label="Errors by code">
              {sum.groups.map(([code, count]) => (
                <li key={code} className={s.errorGroup}>
                  <Tag kind="data" tone="danger">
                    {code}
                  </Tag>
                  <Text
                    variant="base"
                    tone="secondary"
                    as="span"
                  >{`${count} ${count === 1 ? 'target' : 'targets'}`}</Text>
                </li>
              ))}
            </ul>
          ) : null}
          {job.result?.aggregation_error ? (
            <Text
              variant="sm"
              tone="warning"
              as="p"
            >{`Category aggregation did not finish: ${job.result.aggregation_error}`}</Text>
          ) : null}
        </div>
      ) : null}
      {job.status === 'cancelled' ? (
        <Text variant="base" tone="secondary" as="p">
          {`Stopped at ${done} / ${total}; analyzed items were kept.`}
        </Text>
      ) : null}
      {job.status === 'failed' ? (
        <Text variant="base" tone="danger" as="p" role="alert">
          {job.error ?? 'The job failed.'}
        </Text>
      ) : null}
    </div>
  );
}
