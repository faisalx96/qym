import type { AnalysisJob } from '@/api/analysis';
import { runPath } from '@/app/routes';
import { Badge, Button, LinkButton, Tag, Text } from '@/ui';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
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
    <div className={s.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} of ${max}`}>
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

function retryNote(job: AnalysisJob): string | null {
  const p = job.progress;
  if (p.phase !== 'retrying') return null;
  const attempt = p.retry_attempt && p.retry_max_attempts ? ` (attempt ${p.retry_attempt} of ${p.retry_max_attempts})` : '';
  return `Retrying ${p.metric_name ?? 'item'}${p.item_id ? ` on ${p.item_id}` : ''}${attempt}${p.retry_reason ? `: ${p.retry_reason}` : ''}`;
}

export function summarize(job: AnalysisJob) {
  const result = job.result;
  const attempted = Number(result?.total_attempted ?? job.progress.total ?? 0);
  const failedCount = Number(result?.total_analysis_failed ?? job.progress.errors ?? 0);
  const analyzed = Number(result?.total_analyzed ?? Math.max(0, attempted - failedCount));
  const groups = new Map<string, number>();
  for (const r of result?.results ?? []) {
    if (r.error) groups.set(r.error_code || 'error', (groups.get(r.error_code || 'error') ?? 0) + 1);
  }
  return { attempted, analyzed, failed: failedCount, groups: [...groups.entries()] };
}

/**
 * Job status. `bar` = single-line persistent bar (status + progress + Cancel);
 * `card` = full card with the completion summary (error-code groups, View run).
 */
export function JobStatus({ ws, slug, runId, mode }: { ws: RunWorkspace; slug: string; runId: string; mode: 'bar' | 'card' }) {
  const { runner } = ws;
  const job = runner.job;
  if (!job) return null;
  const live = job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  const sum = summarize(job);
  const note = retryNote(job);
  const statusText = job.status === 'cancelling' ? 'Cancelling' : job.status === 'cancelled' ? 'Cancelled' : job.status === 'failed' ? 'Failed' : (PHASE[job.progress.phase] ?? 'Running');
  const tone = job.status === 'completed' ? (sum.failed ? 'warning' : 'success') : job.status === 'failed' ? 'danger' : job.status === 'cancelled' ? 'neutral' : job.progress.phase === 'retrying' ? 'warning' : 'info';
  const done = job.progress.completed;
  const total = job.progress.total;

  if (mode === 'bar') {
    return (
      <div className={s.jobBar} role="region" aria-label="Analysis job" data-status={job.status}>
        <Badge tone={tone} dot>
          {statusText}
        </Badge>
        <Text variant="base" tone="secondary" as="span" className={s.jobText} role="status">
          {live
            ? `${done} / ${total} targets${note ? ` · ${note}` : ''}`
            : job.status === 'completed'
              ? `${sum.analyzed} of ${sum.attempted} metric analyses succeeded${sum.failed ? `, ${sum.failed} failed` : ''}`
              : job.status === 'failed'
                ? (job.error ?? 'The job failed.')
                : `Stopped at ${done} / ${total}; analyzed items were kept.`}
        </Text>
        {live ? <ProgressBar value={done} max={total} label="Analysis progress" /> : <span className={s.spacer} />}
        {live ? (
          <Button size="sm" variant="danger" onPress={runner.cancel} isDisabled={runner.cancelling}>
            {runner.cancelling ? 'Cancelling…' : 'Cancel analysis'}
          </Button>
        ) : (
          <>
            <LinkButton to={runPath(slug, runId)} size="sm">
              View run
            </LinkButton>
            <Button size="sm" onPress={runner.dismiss}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={s.jobCard} data-status={job.status} role="region" aria-label="Analysis job">
      <div className={s.jobHead}>
        <Badge tone={tone} dot>
          {statusText}
        </Badge>
        <Text variant="md" weight={600} as="span">
          {live ? `Running ${done} / ${total}` : job.status === 'completed' ? (sum.failed ? 'Completed with errors' : 'Analysis complete') : job.status === 'failed' ? 'Analysis failed' : 'Analysis cancelled'}
        </Text>
        <span className={s.spacer} />
        {live ? (
          <Button size="sm" variant="danger" onPress={runner.cancel} isDisabled={runner.cancelling}>
            {runner.cancelling ? 'Cancelling…' : 'Cancel analysis'}
          </Button>
        ) : null}
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
            {`${sum.analyzed} of ${sum.attempted} metric analyses succeeded.`}
          </Text>
          {sum.failed ? (
            <ul className={s.errorGroups} aria-label="Errors by code">
              {sum.groups.map(([code, count]) => (
                <li key={code} className={s.errorGroup}>
                  <Tag kind="data" tone="danger">
                    {code}
                  </Tag>
                  <Text variant="base" tone="secondary" as="span">{`${count} ${count === 1 ? 'target' : 'targets'}`}</Text>
                </li>
              ))}
            </ul>
          ) : null}
          {job.result?.aggregation_error ? (
            <Text variant="sm" tone="warning" as="p">{`Category aggregation did not finish: ${job.result.aggregation_error}`}</Text>
          ) : null}
        </div>
      ) : null}
      {job.status === 'failed' && job.error ? (
        <Text variant="base" tone="danger" as="p" role="alert">
          {job.error}
        </Text>
      ) : null}
      {!live ? (
        <div className={s.inline}>
          <LinkButton to={runPath(slug, runId)} variant="accent">
            View run
          </LinkButton>
          <Button onPress={runner.dismiss}>Dismiss</Button>
        </div>
      ) : null}
    </div>
  );
}
