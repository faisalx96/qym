import { useMemo, useState } from 'react';
import { useJobAction, ACTIVE_JOB_STATUSES, type JobStatus, type MaintenanceJob } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { Badge, Button, DataTable, Drawer, KeyValueGrid, Text, useToast, type BadgeTone, type Column } from '@/ui';
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
      toast.show(`${action} failed: ${e instanceof ApiError ? e.detail || `HTTP ${e.status}` : String(e)}`, { tone: 'error' });
    }
  }

  const columns = useMemo<Column<MaintenanceJob>[]>(
    () => [
      { id: 'kind', label: 'Kind', width: 220, mono: true, cell: (j) => j.kind },
      { id: 'status', label: 'Status', width: 140, cell: (j) => <JobStatusBadge status={j.status} /> },
      {
        id: 'progress',
        label: 'Progress',
        flex: true,
        minWidth: 160,
        cell: (j) => (j.error ? <span className={styles.errorText}>{j.error}</span> : (j.progress?.message ?? '—')),
      },
      { id: 'created', label: 'Created', width: 160, cell: (j) => formatDateTime(j.created_at) },
      { id: 'finished', label: 'Finished', width: 160, cell: (j) => formatDateTime(j.finished_at) },
      {
        id: 'actions',
        label: 'Actions',
        hideLabel: true,
        width: 190,
        resizable: false,
        align: 'end',
        cell: (j) => (
          <span className={styles.rowActions}>
            <Button variant="neutral" onPress={() => setLogJob(j)} aria-label={`Log for ${j.kind}`} data-job-log={j.id}>
              Log
            </Button>
            {j.status === 'paused' ? (
              <Button variant="accent" onPress={() => void run(j, 'start')} isDisabled={act.isPending} data-job-start={j.id}>
                Start
              </Button>
            ) : null}
            {ACTIVE_JOB_STATUSES.includes(j.status) || j.status === 'paused' ? (
              <Button variant="ghost" onPress={() => void run(j, 'cancel')} isDisabled={act.isPending || j.status === 'cancel_requested'} data-job-cancel={j.id}>
                Cancel
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act.isPending],
  );

  return (
    <>
      <DataTable aria-label="Maintenance jobs" columns={columns} rows={jobs} rowKey={(j) => j.id} storageKey="admin-jobs" emptyState="No jobs yet." />
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
                { key: 'progress', label: 'Progress', value: JSON.stringify(shown.progress ?? {}), mono: true },
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
