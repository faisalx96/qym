import { useMemo, useState } from 'react';
import { useJobAction, ACTIVE_JOB_STATUSES, type JobStatus, type MaintenanceJob } from '@/api/admin';
import { actionErrorMessage } from '@/lib/http';
import {
  DataTable,
  Drawer,
  KeyValueGrid,
  StatusMark,
  Text,
  useToast,
  type Column,
  type StatusShape,
  type StatusTone,
} from '@/ui';
import { formatDateTime } from '../format';
import styles from './maintenance.module.css';

/** status → tone and figure. Paused waits for Start (hourglass), so it reads apart from Cancelled (pause). */
const FIGURE: Record<JobStatus, [StatusTone, StatusShape]> = {
  queued: ['neutral', 'ring'],
  running: ['info', 'orbit'],
  paused: ['warning', 'hourglass'],
  cancel_requested: ['warning', 'orbit'],
  cancelled: ['warning', 'pause'],
  // C218: success is the normal case, so it is quiet; only failures and waits take a colour
  succeeded: ['neutral', 'full'],
  failed: ['danger', 'cross'],
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const [tone, shape] = FIGURE[status] ?? ['neutral', 'ring'];
  return <StatusMark tone={tone} shape={shape} label={status.replace(/_/g, ' ')} data-status={status} />;
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
      toast.show(actionErrorMessage(`${action.toLowerCase()} the job`, e), {
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
        density="comfortable"
        densityLocked
        empty="No jobs yet."
        refreshing={jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status))}
        rowState={(j) => (j.status === 'failed' ? 'error' : j.status === 'running' ? 'live' : undefined)}
        rowActions={(j) => [
          {
            id: 'log',
            label: `Log for ${j.kind}`,
            icon: 'eye',
            primary: j.status !== 'paused',
            onPress: setLogJob,
          },
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
                  primary: true,
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
