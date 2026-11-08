import { useState } from 'react';
import type { LiveJob } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Tag, Text, type Column } from '@/ui';
import { workerDay } from './format';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function JobsBlock({
  jobs,
  onBackfill,
  onCancelJob,
  busy,
  jobsLimit,
  onJobsLimit,
}: { jobs: LiveJob[]; busy: WorkerBusy; onBackfill: () => void; jobsLimit: number } & Pick<
  WorkerCallbacks,
  'onCancelJob' | 'onJobsLimit'
>) {
  const [cancel, setCancel] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const columns: Column<LiveJob>[] = [
    {
      id: 'kind',
      header: 'Kind',
      priority: 1,
      cell: (row) => (
        <div className={styles.inline}>
          <Tag>{row.kind === 'backfill_preview' ? 'Preview' : 'Backfill'}</Tag>
          {row.params.redo?.includes('all') ? (
            <Tag>redo all</Tag>
          ) : row.params.redo?.includes('inconclusive') ? (
            <Tag>redo inconclusive</Tag>
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
          {row.params.until_day !== row.params.since_day ? ` to ${workerDay(row.params.until_day)}` : ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      priority: 2,
      cell: (row) => (
        <div className={styles.inline}>
          <Tag
            tone={
              row.status === 'running'
                ? row.cancel_requested
                  ? 'warning'
                  : 'accent'
                : row.status === 'done'
                  ? 'success'
                  : row.status === 'failed'
                    ? 'danger'
                    : undefined
            }
          >
            {row.status === 'running' && row.cancel_requested ? 'cancelling' : row.status}
          </Tag>
          {row.progress.paused ? <Tag>paused</Tag> : null}
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
        <div className={styles.wrap}>
          {row.progress.evaluated ?? 0} / {row.progress.found ?? 0} turns evaluated
          {(row.progress.skipped_existing ?? 0) > 0
            ? `, ${row.progress.skipped_existing} already evaluated`
            : ''}
          {(row.progress.redone ?? 0) > 0 ? `, ${row.progress.redone} redone` : ''}
          {`, ${row.progress.failed ?? 0} failed`}
          {typeof row.progress.listed === 'number' ? (
            <Text as="div" variant="sm" tone="muted">
              {row.progress.listed} traces listed
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      id: 'requested_by',
      header: 'Who',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {row.requested_by ?? '—'}
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
          <Button isDisabled={busy.cancelJob || row.cancel_requested} onPress={() => setCancel(row.id)}>
            {row.cancel_requested ? 'Cancel requested' : 'Cancel'}
          </Button>
        ) : null,
    },
  ];
  return (
    <WorkerBlock name="jobs" title="Jobs" aside={<Button onPress={onBackfill}>Backfill a day range</Button>}>
      {jobs.length ? (
        <DataTable
          aria-label="Worker jobs"
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
