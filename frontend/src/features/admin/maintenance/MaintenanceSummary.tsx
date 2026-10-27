import type { MaintenanceOverview } from '@/api/admin';
import { KeyValueGrid, Skeleton } from '@/ui';
import { formatBytes } from '../format';
import styles from './maintenance.module.css';

type Workers = MaintenanceOverview['workers'];

/** One worker as words with a status dot: the word carries the state, the dot only repeats it. */
function WorkerState({ name, alive }: { name: string; alive: boolean | null | undefined }) {
  const state = alive === null || alive === undefined ? 'unknown' : alive ? 'running' : 'stopped';
  return (
    <span className={styles.worker} data-state={state}>
      <span className={styles.workerDot} aria-hidden="true" />
      {name} {state}
    </span>
  );
}

function WorkersValue({ w }: { w: Workers }) {
  const ws = w.workers_service;
  return (
    <span className={styles.workers}>
      <WorkerState name="Summary" alive={w.summary_worker_alive} />
      <WorkerState name="Maintenance" alive={w.maintenance_worker_alive} />
      {ws ? (
        <span className={styles.worker} data-state={ws.alive ? 'running' : 'stopped'} data-workers-service>
          <span className={styles.workerDot} aria-hidden="true" />
          Workers service {ws.alive ? 'running' : 'not responding'} (
          {ws.processes.filter((x) => x.alive).length}/{ws.processes.length} processes)
        </span>
      ) : null}
    </span>
  );
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * Platform settings and worker state: eight facts in two rows of four, plain words and numbers (no pills). The database
 * size comes from the slow statistics request: until it arrives its value is a skeleton of the same height.
 */
export function MaintenanceSummary({
  data,
  sizeBytes,
}: {
  data: MaintenanceOverview;
  sizeBytes?: number | null;
}) {
  const s = data.settings;
  return (
    <div className={styles.summaryCard} data-maintenance-summary>
      <KeyValueGrid
        aria-label="Platform settings"
        columns={4}
        items={[
          {
            key: 'db',
            label: 'Database size',
            value:
              sizeBytes === undefined ? (
                <Skeleton kind="value" width={64} label="Loading the database size" />
              ) : (
                formatBytes(sizeBytes)
              ),
            mono: true,
          },
          { key: 'events', label: 'Event log', value: s.event_log_mode },
          { key: 'spans', label: 'Span retention', value: days(s.span_retention_days), mono: true },
          { key: 'grace', label: 'Deleted-run grace', value: days(s.deleted_run_grace_days), mono: true },
          {
            key: 'partitions',
            label: 'Span partitions ahead',
            value: days(s.span_partition_days_ahead),
            mono: true,
          },
          {
            key: 'role',
            label: 'Role / service',
            value: [s.role, s.service].filter(Boolean).join(' · ') || '—',
          },
          {
            key: 'maint',
            label: 'Maintenance mode',
            value: s.maintenance_mode ? <span className={styles.modeOn}>On</span> : 'Off',
          },
          {
            key: 'workers',
            label: `Workers (${data.workers.loops})`,
            value: <WorkersValue w={data.workers} />,
          },
        ]}
      />
    </div>
  );
}
