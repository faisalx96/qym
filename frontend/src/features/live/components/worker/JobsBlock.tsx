import { useState } from 'react';
import { jobPreviewSentence, type LiveJob, type LiveWorkerControl } from '@/api/liveWorker';
import { formatHeaderDate } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  ProgressCell,
  StatusMark,
  Tag,
  Text,
  Tooltip,
  UserName,
  type Column,
  type StatusShape,
  type StatusTone,
} from '@/ui';
import { workerDay } from './format';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

/** A worker job state as a StatusMark: [tone, shape, word] (B-05). */
const WORKER_JOB_MARK: Record<string, [StatusTone, StatusShape, string]> = {
  queued: ['neutral', 'ring', 'Queued'],
  running: ['info', 'orbit', 'Running'],
  cancelling: ['info', 'orbit', 'Cancelling'],
  paused: ['neutral', 'pause', 'Paused'],
  done: ['success', 'full', 'Done'],
  failed: ['danger', 'cross', 'Failed'],
  cancelled: ['warning', 'pause', 'Cancelled'],
};

function jobMark(row: LiveJob): [StatusTone, StatusShape, string] {
  const key =
    row.status === 'running' && row.cancel_requested
      ? 'cancelling'
      : row.status === 'running' && row.progress.paused
        ? 'paused'
        : row.status;
  return WORKER_JOB_MARK[key] ?? ['neutral', 'ring', row.status];
}

export function JobsBlock({
  jobs,
  workerJob,
  onCancelJob,
  busy,
  jobsLimit,
  onJobsLimit,
}: {
  jobs: LiveJob[];
  workerJob?: LiveWorkerControl['job'];
  zone?: string;
  busy: WorkerBusy;
  jobsLimit: number;
} & Pick<WorkerCallbacks, 'onCancelJob' | 'onJobsLimit'>) {
  const [cancel, setCancel] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const columns: Column<LiveJob>[] = [
    {
      id: 'kind',
      header: 'Kind',
      priority: 1,
      cell: (row) => (
        <div className={styles.inline}>
          <Tag kind="data">{row.kind === 'backfill_preview' ? 'Preview' : 'Backfill'}</Tag>
          {row.params.redo?.includes('all') ? (
            <Tag kind="data">redo all</Tag>
          ) : row.params.redo?.includes('inconclusive') ? (
            <Tag kind="data">redo inconclusive</Tag>
          ) : null}
        </div>
      ),
    },
    {
      id: 'range',
      header: 'Days',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap}>
          {workerDay(row.params.since_day)}
          {row.params.until_day !== row.params.since_day ? ` – ${workerDay(row.params.until_day)}` : ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      priority: 2,
      cell: (row) => (
        <div className={styles.inline}>
          <StatusMark
            tone={jobMark(row)[0]}
            shape={jobMark(row)[1]}
            label={jobMark(row)[2]}
            data-status={row.status}
          />
          {(row.status === 'failed' || row.status === 'cancelled') && row.error ? (
            <Text tone="danger" className={styles.wrap} dir="auto">
              {row.error}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      id: 'progress',
      header: 'Progress',
      priority: 2,
      cell: (row) => (
        <JobProgress
          key={row.id}
          job={row}
          waitingReason={row.id === workerJob?.blocked_job_id ? workerJob.waiting_reason : undefined}
        />
      ),
    },
    {
      id: 'requested_by',
      header: 'Who',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {row.requested_by ? <UserName id={row.requested_by_user_id} name={row.requested_by} /> : '—'}
        </span>
      ),
    },
    {
      id: 'requested_at',
      header: 'When',
      priority: 2,
      cell: (row) => {
        const waiting = row.status === 'running' ? row.progress.waiting?.trim() : '';
        const stale =
          row.status === 'running' && !waiting && Date.now() - Date.parse(row.updated_at) > 10 * 60_000;
        return (
          <div>
            <span title={row.requested_at}>{formatRelative(row.requested_at)}</span>
            <Text as="div" variant="sm" tone={stale ? 'danger' : 'muted'} title={row.updated_at}>
              {waiting
                ? `Waiting: ${waiting}`
                : `${stale ? 'no update for' : 'updated'} ${formatRelative(row.updated_at)}`}
            </Text>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      priority: 2,
      cell: (row) =>
        row.status === 'queued' || row.status === 'running' ? (
          <Tooltip content={row.cancel_requested ? 'Cancel requested' : 'Cancel job'}>
            <IconButton
              tile
              tone="danger"
              icon="ban"
              label={row.cancel_requested ? 'Cancel requested' : 'Cancel job'}
              isDisabled={busy.cancelJob || row.cancel_requested}
              onPress={() => setCancel(row.id)}
            />
          </Tooltip>
        ) : null,
    },
  ];
  return (
    <WorkerBlock name="jobs" title="Jobs" table>
      {jobs.length ? (
        <DataTable
          aria-label="Worker jobs"
          variant="embedded"
          density="regular"
          rows={jobs}
          columns={columns}
          rowKey={(row) => row.id}
          responsive="cards"
        />
      ) : (
        <EmptyState title="No jobs yet" />
      )}
      {jobs.length ? (
        <div className={styles.inline}>
          <Text variant="sm" tone="muted">
            Newest {jobs.length} jobs
          </Text>
          {jobs.length >= jobsLimit && jobsLimit < 200 ? (
            <Button onPress={() => onJobsLimit?.(jobsLimit < 50 ? 50 : jobsLimit < 100 ? 100 : 200)}>
              Show older jobs
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <ErrorState compact error={error} title="Couldn’t cancel the job" message={errorSentence(error)} />
      ) : null}
      <ConfirmDialog
        open={cancel !== null}
        onOpenChange={(open) => {
          if (!open) setCancel(null);
        }}
        title="Cancel job?"
        description="The worker stops the job after the current turns."
        confirmLabel="Cancel job"
        onConfirm={async () => {
          if (cancel === null) return;
          setError(null);
          try {
            await onCancelJob(cancel);
          } catch (e) {
            setError(e);
            throw new Error(errorSentence(e));
          }
        }}
      />
    </WorkerBlock>
  );
}

function JobProgress({ job, waitingReason }: { job: LiveJob; waitingReason?: string }) {
  const p = job.progress;
  const [hadRedone, setHadRedone] = useState((p.redone ?? 0) > 0);
  if (!hadRedone && (p.redone ?? 0) > 0) setHadRedone(true);
  const summary = [
    `${p.evaluated ?? 0} evaluated`,
    ...((p.redone ?? 0) > 0 || hadRedone ? [`${p.redone ?? 0} redone`] : []),
    `${p.failed ?? 0} failed`,
    `${p.skipped_existing ?? 0} already evaluated`,
    `${p.found ?? 0} turns in the range`,
    ...((p.resumed ?? 0) > 0 ? [`${p.resumed} from an earlier attempt`] : []),
    ...((p.fetch_failed ?? 0) > 0
      ? [`${p.fetch_failed} could not be fetched, will be retried by the next backfill`]
      : []),
  ].join(' · ');
  const rejected = p.rejected;
  const rejections =
    rejected && (p.listed ?? 0) > (p.found ?? 0)
      ? [
          `${p.found ?? 0} user turns`,
          ...((rejected.other_names ?? 0) > 0 ? [`${rejected.other_names} other traces`] : []),
          ...((rejected.excluded_users ?? 0) > 0 ? [`${rejected.excluded_users} from excluded users`] : []),
          ...((rejected.no_session ?? 0) > 0 ? [`${rejected.no_session} without a conversation`] : []),
          ...((rejected.other_environment ?? 0) > 0
            ? [`${rejected.other_environment} from other environments`]
            : []),
          ...((rejected.bad_timestamp ?? 0) > 0
            ? [`${rejected.bad_timestamp} with an invalid timestamp`]
            : []),
        ].join(', ')
      : null;
  return (
    <div className={styles.wrap}>
      {job.kind === 'backfill' && job.status !== 'queued' ? (
        <ProgressCell
          done={p.evaluated ?? 0}
          total={p.found ?? 0}
          failed={p.failed ?? 0}
          showFailed={job.status !== 'failed'}
        />
      ) : null}
      {job.status === 'queued'
        ? waitingReason?.trim()
          ? `Waiting: ${waitingReason}`
          : 'Queued'
        : job.kind === 'backfill_preview'
          ? jobPreviewSentence(job)
          : summary}
      {job.kind === 'backfill' && (p.recorded ?? 0) + (p.incomplete ?? 0) > 0 ? (
        <Text as="div" variant="sm" tone="muted">
          Of the evaluated: {p.judged ?? 0} judged, {p.recorded ?? 0} recorded without judges (cancelled or
          failed in Insightor), {p.incomplete ?? 0} incomplete
        </Text>
      ) : null}
      {job.kind === 'backfill' && p.limit_reached ? (
        <Text as="div" variant="sm" tone="warning">
          Stopped at the limit of {job.params.limit}. {p.remaining ?? 0} turns in this range are still not
          evaluated.
        </Text>
      ) : null}
      <Text as="div" variant="sm" tone="muted">
        Limit {job.params.limit} · redo {job.params.redo?.join(', ') || 'none'}
      </Text>
      {(p.deferred ?? 0) > 0 ? (
        <Text as="div" variant="sm" tone="muted">
          {p.deferred} left to the live loop (still arriving)
        </Text>
      ) : null}
      {p.effective_until ? (
        <Text as="div" variant="sm" tone="muted">
          Covers turns up to {formatHeaderDate(p.effective_until)}; later turns are left to the live loop.
        </Text>
      ) : null}
      {typeof p.listed === 'number' ? (
        <Text as="div" variant="sm" tone="muted">
          {p.listed} traces listed{rejections ? `: ${rejections}` : ''}
        </Text>
      ) : null}
    </div>
  );
}
