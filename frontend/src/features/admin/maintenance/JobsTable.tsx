import { useMemo, useState } from 'react';
import { useJobAction, ACTIVE_JOB_STATUSES, type JobStatus, type MaintenanceJob } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { Badge, DataTable, Drawer, KeyValueGrid, Text, useToast, type BadgeTone, type Column } from '@/ui';
import { formatDateTime } from '../format';
import styles from './maintenance.module.css';

const TONE: Record<JobStatus, BadgeTone> = {
  queued: 'neutral',
  running: 'info',
  paused: 'warning',
  cancel_requested: 'warning',
  cancelled: 'warning',
  succeeded: 'success',
  failed: 'danger',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge tone={TONE[status] ?? 'neutral'} dot={status === 'running'}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

export interface JobsTableProps {
  jobs: MaintenanceJob[];
}

/** Jobs: status, progress message, timestamps, Log (drawer) / Start (paused) / Cancel (active). */
export function JobsTable({ jobs }: JobsTableProps) {
  const [logJob, setLogJob] = useState<MaintenanceJob | null>(null);
  const act = useJobAction();
  const toast = useToast();
  // Keep the drawer in sync with polling updates.
  const shown = logJob ? (jobs.find((j) => j.id === logJob.id) ?? logJob) : null;

  async function run(job: MaintenanceJob, action: 'start' | 'cancel') {
    try {
      await act.mutateAsync({ id: job.id, action });
      toast.show(`${action === 'start' ? 'Started' : 'Cancel requested for'} ${job.kind}`, { tone: 'info' });
    } catch (e) {
      toast.show(`${action} failed: ${e instanceof ApiError ? e.detail || `HTTP ${e.status}` : String(e)}`, {
        tone: 'error',
      });
    }
  }

  const columns = useMemo<Column<MaintenanceJob>[]>(
    () => [
      {
        id: 'kind',
        header: 'Kind',
        type: 'id',
        width: 220,
        pin: 'start',
        hideable: false,
        priority: 1,
        cell: (j) => j.kind,
      },
      {
        id: 'status',
        header: 'Status',
        type: 'status',
        width: 140,
        priority: 1,
        cell: (j) => <JobStatusBadge status={j.status} />,
      },
      {
        id: 'progress',
        header: 'Progress',
        flex: true,
        minWidth: 160,
        priority: 2,
        cell: (j) =>
          j.error ? <span className={styles.errorText}>{j.error}</span> : (j.progress?.message ?? '—'),
      },
      {
        id: 'created',
        header: 'Created',
        type: 'date',
        width: 160,
        priority: 3,
        cell: (j) => formatDateTime(j.created_at),
      },
      {
        id: 'finished',
        header: 'Finished',
        type: 'date',
        width: 160,
        priority: 3,
        cell: (j) => formatDateTime(j.finished_at),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable<MaintenanceJob>
        aria-label="Maintenance jobs"
        columns={columns}
        rows={jobs}
        rowKey={(j) => j.id}
        storageKey="admin-jobs"
        density="regular"
        empty="No jobs yet."
        refreshing={jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status))}
        rowState={(j) => (j.status === 'failed' ? 'error' : j.status === 'running' ? 'live' : undefined)}
        rowActions={(j) => [
          { id: 'log', label: `Log for ${j.kind}`, icon: 'eye', primary: true, onPress: setLogJob },
          ...(j.status === 'paused'
            ? [
                {
                  id: 'start',
                  label: `Start ${j.kind}`,
                  icon: 'play',
                  primary: true,
                  disabled: act.isPending,
                  onPress: (job: MaintenanceJob) => void run(job, 'start'),
                },
              ]
            : []),
          ...(ACTIVE_JOB_STATUSES.includes(j.status) || j.status === 'paused'
            ? [
                {
                  id: 'cancel',
                  label: `Cancel ${j.kind}`,
                  icon: 'close',
                  danger: true,
                  disabled: act.isPending || j.status === 'cancel_requested',
                  onPress: (job: MaintenanceJob) => void run(job, 'cancel'),
                },
              ]
            : []),
        ]}
      >
        <DataTable.Footer summary={`${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`} />
      </DataTable>
      <Drawer
        open={shown !== null}
        onOpenChange={(o) => !o && setLogJob(null)}
        title={shown ? `${shown.kind} log` : 'Job log'}
        subtitle={shown ? <JobStatusBadge status={shown.status} /> : undefined}
        width={640}
      >
        {shown ? (
          <div className={styles.logMeta} data-job-log-drawer>
            <KeyValueGrid
              aria-label="Job details"
              columns={2}
              dense
              items={[
                { key: 'id', label: 'Job id', value: shown.id, mono: true },
                { key: 'created', label: 'Created', value: formatDateTime(shown.created_at) },
                { key: 'started', label: 'Started', value: formatDateTime(shown.started_at) },
                { key: 'finished', label: 'Finished', value: formatDateTime(shown.finished_at) },
                { key: 'params', label: 'Params', value: JSON.stringify(shown.params ?? {}), mono: true },
                {
                  key: 'progress',
                  label: 'Progress',
                  value: JSON.stringify(shown.progress ?? {}),
                  mono: true,
                },
              ]}
            />
            {shown.error ? (
              <Text variant="sm" tone="danger" role="alert">
                {shown.error}
              </Text>
            ) : null}
            {/* scrollable region must be keyboard-focusable (axe scrollable-region-focusable) */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <pre className={styles.log} tabIndex={0} aria-label="Log output">
              {shown.log || '(no log output yet)'}
            </pre>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
