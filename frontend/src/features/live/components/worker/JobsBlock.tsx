import { useState } from 'react';
import type { LiveJob } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Tag, Text, type Column } from '@/ui';
import { DateRangeDialog } from './DateRangeDialog';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerBusy, WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function JobsBlock({
  jobs,
  onCreateJob,
  onCancelJob,
  busy,
}: { jobs: LiveJob[]; busy: WorkerBusy } & Pick<WorkerCallbacks, 'onCreateJob' | 'onCancelJob'>) {
  const [range, setRange] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const columns: Column<LiveJob>[] = [
    {
      id: 'kind',
      header: 'Kind',
      priority: 1,
      cell: (row) => <Tag>{row.kind === 'backfill_preview' ? 'Preview' : 'Backfill'}</Tag>,
    },
    {
      id: 'range',
      header: 'Range',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap}>
          {row.params.since_day} → {row.params.until_day}
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
                ? 'accent'
                : row.status === 'done'
                  ? 'success'
                  : row.status === 'failed'
                    ? 'danger'
                    : undefined
            }
          >
            {row.status}
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
        <span className={styles.wrap}>
          {row.progress.evaluated ?? 0} / {row.progress.found ?? 0} evaluated, {row.progress.failed ?? 0}{' '}
          failed
        </span>
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
      cell: (row) => <span title={row.requested_at}>{formatRelative(row.requested_at)}</span>,
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
    <WorkerBlock
      name="jobs"
      title="Jobs"
      aside={<Button onPress={() => setRange(true)}>Evaluate a date range</Button>}
    >
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
      {error ? (
        <ErrorState compact error={error} title="Couldn’t cancel the job" message={errorSentence(error)} />
      ) : null}
      <DateRangeDialog
        key={range ? 'open' : 'closed'}
        open={range}
        onOpenChange={setRange}
        jobs={jobs}
        onCreateJob={onCreateJob}
        busy={busy.createJob}
      />
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
