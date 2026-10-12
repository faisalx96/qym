import type { MaintenanceOverview } from '@/api/admin';
import { Badge, KeyValueGrid } from '@/ui';
import { formatBytes } from '../format';
import styles from './maintenance.module.css';

function alive(v: boolean | null | undefined, label: string) {
  if (v === null || v === undefined) return <Badge tone="neutral">{label}: unknown</Badge>;
  return <Badge tone={v ? 'success' : 'danger'} dot={v}>{`${label}: ${v ? 'running' : 'stopped'}`}</Badge>;
}

function workersService(ws: NonNullable<MaintenanceOverview['workers']['workers_service']>) {
  const up = ws.processes.filter((x) => x.alive).length;
  return (
    <Badge tone={ws.alive ? 'success' : 'danger'} dot={ws.alive} data-workers-service>
      {ws.alive ? 'workers service running' : 'workers service NOT RESPONDING'} ({up}/{ws.processes.length} processes)
    </Badge>
  );
}

/** The old one-sentence header as a scannable key/value grid. */
export function MaintenanceSummary({ data }: { data: MaintenanceOverview }) {
  const s = data.settings;
  const w = data.workers;
  const size = 'error' in data.db_stats ? null : data.db_stats.database?.size_bytes;
  return (
    <div className={styles.summaryCard} data-maintenance-summary>
      <KeyValueGrid
        aria-label="Platform settings"
        columns={3}
        dense
        items={[
          { key: 'db', label: 'Database size', value: typeof size === 'number' ? formatBytes(size) : '—', mono: true },
          { key: 'role', label: 'Role / service', value: [s.role, s.service].filter(Boolean).join(' · ') || '—', mono: true },
          {
            key: 'maint',
            label: 'Maintenance mode',
            value: s.maintenance_mode ? <Badge tone="warning">on</Badge> : <Badge tone="neutral">off</Badge>,
          },
          { key: 'events', label: 'Event log', value: s.event_log_mode, mono: true },
          { key: 'spans', label: 'Span retention', value: `${s.span_retention_days} d`, mono: true },
          { key: 'grace', label: 'Deleted-run grace', value: `${s.deleted_run_grace_days} d`, mono: true },
          { key: 'partitions', label: 'Span partitions ahead', value: `${s.span_partition_days_ahead} d`, mono: true },
          { key: 'workers', label: `Workers (${w.loops})`, value: <span className={styles.workers}>{alive(w.summary_worker_alive, 'summary')} {alive(w.maintenance_worker_alive, 'maintenance')}{w.workers_service ? <> {workersService(w.workers_service)}</> : null}</span> },
        ]}
      />
    </div>
  );
}
