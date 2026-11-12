import { useState } from 'react';
import type { LiveJob } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import {
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
  cancelling: ['warning', 'orbit', 'Cancelling'],
  paused: ['neutral', 'hourglass', 'Paused'],
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
  onCancelJob,
  busy,
}: { jobs: LiveJob[]; busy: WorkerBusy } & Pick<WorkerCallbacks, 'onCancelJob'>) {
  const [cancel, setCancel] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const columns: Column<LiveJob>[] = [
    {
      id: 'kind',
      header: 'Kind',
      priority: 1,
      cell: (row) => <Tag kind="data">{row.kind === 'backfill_preview' ? 'Preview' : 'Backfill'}</Tag>,
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
          {row.status === 'failed' && row.error ? (
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
        <ProgressCell
          done={row.progress.evaluated ?? 0}
          total={row.progress.found ?? 0}
          failed={row.progress.failed ?? 0}
          showFailed={row.status !== 'failed'}
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
        const stale = row.status === 'running' && Date.now() - Date.parse(row.updated_at) > 10 * 60_000;
        return (
          <div>
            <span title={row.requested_at}>{formatRelative(row.requested_at)}</span>
            <Text as="div" variant="sm" tone={stale ? 'danger' : 'muted'} title={row.updated_at}>
              {stale ? 'no update for' : 'updated'} {formatRelative(row.updated_at)}
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
