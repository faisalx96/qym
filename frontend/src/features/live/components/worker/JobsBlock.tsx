import { useState } from 'react';
import { Link } from 'react-router-dom';
import { jobPreviewSentence, jobTurnId, type LiveJob, type LiveWorkerControl } from '@/api/liveWorker';
import { useOptionalProject } from '@/features/shell/ProjectContext';
import { APP_LOCALE, formatHeaderDate } from '@/lib/dates';
import { textDirAttrs } from '@/lib/text';
import { errorSentence } from '@/lib/http';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  ProgressCell,
  StatusMark,
  Text,
  UserName,
  type Column,
  type StatusShape,
  type StatusTone,
} from '@/ui';
import { turnHref } from '../turn/presentation';
import { jobKindWord, jobUpdateText, workerDay, workerTime } from './format';
import { WorkerBlock, WorkerPagination } from './WorkerBlock';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

const JOBS_PAGE_SIZE = 5;

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

function hasJobError(row: LiveJob): boolean {
  return (row.status === 'failed' || row.status === 'cancelled') && Boolean(row.error);
}

function jobOptionsTitle({ kind, params }: LiveJob): string | undefined {
  // A re-evaluation has no options: it redoes its one turn.
  if (kind === 'reevaluate') return undefined;
  // Match DateRangeDialog's defaults; older jobs may omit redo (the server default is failed).
  const redo = params.redo ?? ['failed'];
  return (
    [
      ...(params.limit !== 200 ? [`Limit ${params.limit}`] : []),
      ...(redo.length !== 1 || redo[0] !== 'failed' ? [`redo ${redo.join(', ') || 'none'}`] : []),
    ].join(' · ') || undefined
  );
}

export function JobsBlock({
  jobs,
  workerJob,
  onCancelJob,
  busy,
  jobsLimit,
  onJobsLimit,
  jobsPending = false,
  workerStale = false,
  source,
}: {
  jobs: LiveJob[];
  workerJob?: LiveWorkerControl['job'];
  zone?: string;
  /** The live source, for the link from a re-evaluation to its turn. */
  source?: string;
  busy: WorkerBusy;
  jobsLimit: number;
  jobsPending?: boolean;
  workerStale?: boolean;
} & Pick<WorkerCallbacks, 'onCancelJob' | 'onJobsLimit'>) {
  const slug = useOptionalProject()?.slug;
  const [cancel, setCancel] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [pendingPage, setPendingPage] = useState<{ page: number; limit: number } | null>(null);
  const pages = Math.max(1, Math.ceil(jobs.length / JOBS_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const hasMore = Boolean(onJobsLimit) && jobs.length >= jobsLimit && jobsLimit < 200;
  if (page !== currentPage) setPage(currentPage);
  if (pendingPage && !jobsPending) {
    // A failed expansion rolls jobsLimit back in WorkerPage and keeps the current page and drafts.
    if (jobsLimit === pendingPage.limit) setPage(Math.min(pendingPage.page, pages));
    setPendingPage(null);
  }
  function changePage(next: number) {
    if (pendingPage) return;
    if (next <= pages) setPage(next);
    else if (hasMore) {
      const limit = jobsLimit < 50 ? 50 : jobsLimit < 100 ? 100 : 200;
      setPendingPage({ page: next, limit });
      onJobsLimit?.(limit);
    }
  }
  const columns: Column<LiveJob>[] = [
    {
      id: 'kind',
      header: 'Kind',
      width: 120,
      priority: 1,
      cell: (row) => (
        <Text tone="primary" title={jobOptionsTitle(row)}>
          {jobKindWord(row.kind)}
        </Text>
      ),
    },
    {
      id: 'range',
      header: 'Days',
      width: 120,
      priority: 2,
      cell: (row) => {
        if (row.kind === 'reevaluate') {
          // One turn, not a day range: the link opens it.
          const turn = jobTurnId(row);
          return turn && slug && source ? (
            <Link to={turnHref(slug, source, turn)} data-link="name" data-live-block="job-turn">
              1 turn
            </Link>
          ) : (
            <span className={styles.wrap}>1 turn</span>
          );
        }
        return (
          <span className={styles.wrap}>
            {workerDay(row.params.since_day)}
            {row.params.until_day !== row.params.since_day ? ` – ${workerDay(row.params.until_day)}` : ''}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      priority: 2,
      cell: (row) => (
        <StatusMark
          tone={jobMark(row)[0]}
          shape={jobMark(row)[1]}
          label={jobMark(row)[2]}
          data-status={row.status}
        />
      ),
    },
    {
      id: 'progress',
      header: 'Progress',
      flex: true,
      minWidth: 180,
      priority: 2,
      cell: (row) => <JobProgress job={row} />,
    },
    ...(
      [
        ['evaluated', 'Evaluated'],
        ['failed', 'Failed'],
        ['skipped_existing', 'Already done'],
      ] as const
    ).map(([key, header]): Column<LiveJob> => ({
      id: key,
      header,
      width: key === 'skipped_existing' ? 110 : 90,
      align: 'end',
      priority: 2,
      cell: (row) => (
        <span
          className={styles.number}
          data-tone={key === 'failed' && row.progress.failed ? 'danger' : undefined}
        >
          {(
            (row.progress[key] ?? 0) +
            // A redone turn was evaluated again: count it with the evaluated ones.
            (key === 'evaluated' ? (row.progress.redone ?? 0) : 0)
          ).toLocaleString(APP_LOCALE)}
        </span>
      ),
    })),
    {
      id: 'requested_by',
      header: 'Started by',
      width: 150,
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap} {...textDirAttrs(row.requested_by)}>
          {row.requested_by ? <UserName wrap id={row.requested_by_user_id} name={row.requested_by} /> : '—'}
        </span>
      ),
    },
    {
      id: 'requested_at',
      header: 'Started',
      width: 150,
      priority: 2,
      cell: (row) => {
        const waiting = row.status === 'running' ? row.progress.waiting?.trim() : '';
        const stale =
          row.status === 'running' &&
          (workerStale || (!waiting && Date.now() - Date.parse(row.updated_at) > 10 * 60_000));
        return (
          <div className={styles.wrap}>
            <time dateTime={row.started_at ?? row.requested_at} title={row.started_at ?? row.requested_at}>
              {workerTime(row.started_at ?? row.requested_at)}
            </time>
            <Text as="div" variant="sm" tone={stale ? 'danger' : 'muted'} title={row.updated_at}>
              {waiting && !workerStale ? `Waiting: ${waiting}` : jobUpdateText(row.updated_at, stale)}
            </Text>
            <JobDetails
              key={row.id}
              job={row}
              waitingReason={row.id === workerJob?.blocked_job_id ? workerJob.waiting_reason : undefined}
            />
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      hideLabel: true,
      width: 140,
      priority: 2,
      cell: (row) =>
        row.status === 'queued' || row.status === 'running' ? (
          <Button
            variant="danger"
            isDisabled={busy.cancelJob || row.cancel_requested}
            onPress={() => setCancel(row.id)}
          >
            {row.cancel_requested ? 'Cancel requested' : 'Cancel'}
          </Button>
        ) : null,
    },
  ];
  return (
    <WorkerBlock
      name="jobs"
      title="Jobs"
      table
      footer={
        jobs.length ? (
          <WorkerPagination
            total={jobs.length}
            page={currentPage}
            pageSize={JOBS_PAGE_SIZE}
            noun="jobs"
            hasMore={hasMore}
            totalIsLowerBound={jobs.length >= jobsLimit}
            onPageChange={changePage}
          />
        ) : undefined
      }
    >
      {jobs.length ? (
        <DataTable
          aria-label="Worker jobs"
          variant="embedded"
          density="regular"
          verticalAlign="top"
          fit="declared"
          rows={jobs.slice((currentPage - 1) * JOBS_PAGE_SIZE, currentPage * JOBS_PAGE_SIZE)}
          columns={columns}
          rowKey={(row) => row.id}
          expanded={new Set(jobs.filter(hasJobError).map((row) => row.id))}
          expandColumn={false}
          canExpand={hasJobError}
          renderExpanded={(row) =>
            row.error ? (
              <div className={styles.jobError}>
                <Text tone="danger" className={styles.wrap} {...textDirAttrs(row.error)}>
                  {row.error}
                </Text>
              </div>
            ) : null
          }
          responsive="cards"
        />
      ) : (
        <EmptyState title="No jobs yet" />
      )}
      {pendingPage ? (
        <Text as="div" variant="sm" tone="muted" className={styles.loadingJobs} role="status">
          Loading older jobs…
        </Text>
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

function JobProgress({ job }: { job: LiveJob }) {
  const p = job.progress;
  if (job.status === 'queued') return null;
  return (
    <ProgressCell
      // Redone turns are finished work too: a re-evaluation or a redo backfill has only those.
      done={
        job.kind === 'backfill_preview' && job.status === 'done'
          ? (p.found ?? 0)
          : (p.evaluated ?? 0) + (p.redone ?? 0)
      }
      total={p.found ?? 0}
      failed={p.failed ?? 0}
      countFormat="words"
    />
  );
}

function JobDetails({ job, waitingReason }: { job: LiveJob; waitingReason?: string }) {
  const p = job.progress;
  const [hadRedone, setHadRedone] = useState((p.redone ?? 0) > 0);
  if (!hadRedone && (p.redone ?? 0) > 0) setHadRedone(true);
  const summary = [
    ...((p.redone ?? 0) > 0 || hadRedone ? [`${p.redone ?? 0} redone`] : []),
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
      <Text as="div" variant="sm" tone="muted">
        {job.status === 'queued'
          ? waitingReason?.trim()
            ? `Waiting: ${waitingReason}`
            : 'Queued'
          : job.kind === 'backfill_preview'
            ? jobPreviewSentence(job)
            : summary}
      </Text>
      {job.kind === 'backfill' && (p.recorded ?? 0) + (p.incomplete ?? 0) > 0 ? (
        <Text as="div" variant="sm" tone="muted">
          Of the evaluated: {p.judged ?? 0} judged, {p.recorded ?? 0} recorded without judges (cancelled or
          failed in Insightor), {p.incomplete ?? 0} incomplete
        </Text>
      ) : null}
      {job.kind === 'backfill' && p.limit_reached ? (
        <Text as="div" variant="sm" tone="warning">
          {p.listing_stopped_early
            ? // The worker stopped listing once it had enough turns, so the rest was never counted.
              `Stopped at the limit of ${job.params.limit}. ${(p.evaluated ?? 0) + (p.redone ?? 0)} done, more exist.`
            : `Stopped at the limit of ${job.params.limit}. ${p.remaining ?? 0} turns in this range are still not evaluated.`}
        </Text>
      ) : null}
      {(p.deferred ?? 0) > 0 ? (
        <Text as="div" variant="sm" tone="muted">
          {p.deferred} left to the live loop (still arriving)
        </Text>
      ) : null}
      {p.effective_until && job.kind !== 'reevaluate' ? (
        <Text as="div" variant="sm" tone="muted">
          Covers turns up to {formatHeaderDate(p.effective_until)}; later turns are left to the live loop.
        </Text>
      ) : null}
      {typeof p.listed === 'number' && job.kind !== 'reevaluate' ? (
        <Text as="div" variant="sm" tone="muted">
          {p.listed} traces listed{rejections ? `: ${rejections}` : ''}
        </Text>
      ) : null}
    </div>
  );
}
