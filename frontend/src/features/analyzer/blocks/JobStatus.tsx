import { useEffect, useRef } from 'react';
import type { AnalysisJob } from '@/api/analysis';
import { runPath } from '@/app/routes';
import { Badge, Button, LinkButton, Tag, Text } from '@/ui';
import type { RunnerState } from '../useAnalysisRunner';
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

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Link to the run page, keeping the analysed sample (`?pass=N`) of a repeat run. */
export function viewRunTo(slug: string, runId: string, pass: number | null | undefined): string {
  return `${runPath(slug, runId)}${pass != null ? `?pass=${pass}` : ""}`;
}

/**
 * Outcome of a finished job (old `_analysisCompletionState`): failures are the largest of the
 * reported error counts and the results carrying an error; "analyzed" is attempted minus failures
 * (the server's `total_analyzed` also counts the failed ones).
 */
export function summarize(job: AnalysisJob) {
  const result = job.result;
  const results = result?.results ?? [];
  const errored = results.filter((r) => String(r?.error ?? "").trim());
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
    const code = String(r.error_code ?? "").trim() || "analysis_error";
    groups.set(code, (groups.get(code) ?? 0) + 1);
  }
  const cats = result?.categories;
  const categories = Array.isArray(cats)
    ? cats.length
    : cats && typeof cats === "object"
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

/** One sentence for the bar, the Review card and the toast. */
export function outcomeText(sum: ReturnType<typeof summarize>): string {
  const base = `${sum.analyzed} of ${sum.attempted} metric analyses succeeded`;
  return sum.failed ? `${base}, ${sum.failed} failed` : base;
}

/**
 * Job status. `bar` = single-line persistent bar (status + progress + Cancel);
 * `card` = full card with the completion summary (error-code groups, View run).
 */
export function JobStatus({
  runner,
  slug,
  runId,
  mode,
  onReview,
}: {
  runner: RunnerState;
  slug: string;
  runId: string;
  mode: 'bar' | 'card';
  onReview?: () => void;
}) {
  const job = runner.job;
  const region = useRef<HTMLDivElement>(null);
  const jobId = job?.job_id;
  // Move focus to the status region when a job starts (the Analyze button just got disabled).
  useEffect(() => {
    if (jobId && mode === 'bar') region.current?.focus();
  }, [jobId, mode]);
  const cancelling = runner.cancelling;
  useEffect(() => {
    if (cancelling) region.current?.focus();
  }, [cancelling]);
  if (!job) return null;
  const live = job.status === 'queued' || job.status === 'running' || job.status === 'cancelling';
  const sum = summarize(job);
  const note = runner.reconnecting ? "Reconnecting to the background analysis…" : retryNote(job);
  const completedLabel = sum.allFailed ? "Analysis failed" : sum.failed ? "Completed with errors" : "Completed";
  const statusText =
    job.status === "completed"
      ? completedLabel
      : job.status === "cancelling"
        ? "Cancelling"
        : job.status === "cancelled"
          ? "Cancelled"
          : job.status === "failed"
            ? "Failed"
            : (PHASE[job.progress.phase] ?? "Running");
  const tone =
    job.status === "completed"
      ? sum.allFailed
        ? "danger"
        : sum.failed
          ? "warning"
          : "success"
      : job.status === "failed"
        ? "danger"
        : job.status === "cancelled"
          ? "neutral"
          : job.progress.phase === "retrying"
            ? "warning"
            : "info";
  const done = job.progress.completed;
  const total = job.progress.total;

  if (mode === 'bar') {
    return (
      <div ref={region} tabIndex={-1} className={s.jobBar} role="region" aria-label="Analysis job" data-status={job.status}>
        <Badge tone={tone} dot>
          {statusText}
        </Badge>
        <Text variant="base" tone="secondary" as="span" className={s.jobText} role="status">
          {live
            ? `${done} / ${total} targets${note ? ` · ${note}` : ""}`
            : job.status === "completed"
              ? outcomeText(sum)
              : job.status === "failed"
                ? (job.error ?? "The job failed.")
                : `Stopped at ${done} / ${total}; analyzed items were kept.`}
        </Text>
        {live ? <ProgressBar value={done} max={total} label="Analysis progress" /> : <span className={s.spacer} />}
        {live ? (
          <Button size="sm" variant="danger" onPress={runner.cancel} isDisabled={runner.cancelling}>
            {runner.cancelling ? 'Cancelling…' : 'Cancel analysis'}
          </Button>
        ) : (
          <>
            {onReview ? (
              <Button size="sm" variant="accent" onPress={onReview}>
                Review results
              </Button>
            ) : null}
            <LinkButton to={viewRunTo(slug, runId, job.pass_number)} size="sm">
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
          {live
            ? `Running ${done} / ${total}`
            : job.status === "completed"
              ? sum.allFailed
                ? "Analysis failed"
                : sum.failed
                  ? "Completed with errors"
                  : "Analysis complete"
              : job.status === "failed"
                ? "Analysis failed"
                : "Analysis cancelled"}
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
            {`${outcomeText(sum)}.`}
          </Text>
          {!sum.allFailed && !job.result?.aggregation_error ? (
            <Text
              variant="base"
              tone="secondary"
              as="p"
            >{`Created ${sum.categories} ${sum.categories === 1 ? "category" : "categories"}`}</Text>
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
          <LinkButton to={viewRunTo(slug, runId, job.pass_number)} variant="accent">
            View run
          </LinkButton>
          <Button onPress={runner.dismiss}>Dismiss</Button>
        </div>
      ) : null}
    </div>
  );
}
