import type { MaintenanceOverview } from '@/api/admin';
import { retentionLabel } from '@/lib/retention';
import { KeyValueGrid, Skeleton } from '@/ui';
import { formatBytes, formatCount } from '../format';
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

export interface OutboxStats {
  total_bytes: number;
  rows: number;
  oldest_age_seconds: number | null;
}

/** An age in its largest whole unit: '31 days', '5 h', '40 min'. */
function age(seconds: number): string {
  if (seconds >= 86_400) return days(Math.floor(seconds / 86_400));
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)} h`;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
}

/** The outbox fact (C074): size and rows, and the oldest row's age when there is one. */
export function outboxText(o: OutboxStats): string {
  const parts = [formatBytes(o.total_bytes), `${formatCount(o.rows)} rows`];
  if (o.oldest_age_seconds !== null && o.rows > 0) parts.push(`oldest ${age(o.oldest_age_seconds)}`);
  return parts.join(' · ');
}

/**
 * Platform settings and worker state: plain words and numbers in rows of four (no pills). The database size and the
 * outbox come from the slow statistics request: until it arrives their values are skeletons of the same height.
 */
export function MaintenanceSummary({
  data,
  sizeBytes,
  outbox,
}: {
  data: MaintenanceOverview;
  sizeBytes?: number | null;
  /** undefined = still loading, null = not available (SQLite, or the statistics failed). */
  outbox?: OutboxStats | null;
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
          ...(outbox === null
            ? []
            : [
                {
                  key: 'outbox',
                  label: 'Outbox',
                  value:
                    outbox === undefined ? (
                      <Skeleton kind="value" width={96} label="Loading the outbox size" />
                    ) : (
                      outboxText(outbox)
                    ),
                  mono: true,
                },
              ]),
          { key: 'events', label: 'Event log', value: s.event_log_mode },
          { key: 'spans', label: 'Span retention', value: days(s.span_retention_days), mono: true },
          {
            key: 'grace',
            label: 'Deleted runs retention',
            value: retentionLabel(s.deleted_run_grace_days),
            mono: s.deleted_run_grace_days !== 0,
          },
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
