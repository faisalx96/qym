import { useMaintenance, useRefreshMaintenance, type MaintenanceOverview } from '@/api/admin';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  DataTable,
  ErrorState,
  SectionHeader,
  Skeleton,
  Stack,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { formatBytes, formatCount } from '../format';
import { EnqueueJobForm } from './EnqueueJobForm';
import { JobsTable } from './JobsTable';
import { MaintenanceSummary } from './MaintenanceSummary';
import styles from './maintenance.module.css';

type DbStats = Exclude<MaintenanceOverview['db_stats'], { error: string }>;
type TableRow = NonNullable<DbStats['tables']>[number];
type EventRow = NonNullable<DbStats['run_events_by_type']>[number];

const TABLE_COLS: Column<TableRow>[] = [
  { id: 'table', header: 'Table', flex: true, minWidth: 140, type: 'id', cell: (r) => r.table },
  {
    id: 'total',
    header: 'Total',
    width: 80,
    type: 'number',
    cell: (r) => formatBytes(r.total_bytes),
  },
  { id: 'heap', header: 'Heap', width: 80, type: 'number', cell: (r) => formatBytes(r.heap_bytes) },
  {
    id: 'toast',
    header: 'TOAST',
    width: 80,
    type: 'number',
    cell: (r) => formatBytes(r.toast_bytes),
  },
  {
    id: 'index',
    header: 'Indexes',
    width: 80,
    type: 'number',
    cell: (r) => formatBytes(r.index_bytes),
  },
  {
    id: 'live',
    header: 'Live rows',
    width: 90,
    type: 'number',
    cell: (r) => formatCount(r.live_rows),
  },
  {
    id: 'dead',
    header: 'Dead rows',
    width: 90,
    type: 'number',
    cell: (r) => formatCount(r.dead_rows),
  },
];
const EVENT_COLS: Column<EventRow>[] = [
  { id: 'type', header: 'Event type', flex: true, minWidth: 120, type: 'id', cell: (r) => r.type },
  { id: 'rows', header: 'Rows', width: 90, type: 'number', cell: (r) => formatCount(r.rows) },
  {
    id: 'payload',
    header: 'Payload',
    width: 90,
    type: 'number',
    cell: (r) => formatBytes(r.payload_bytes),
  },
];

export function MaintenanceTab() {
  const q = useMaintenance();
  const refresh = useRefreshMaintenance();
  const toast = useToast();
  const skeleton = useDelayedPending(q.isPending);
  if (q.isError)
    return <ErrorState error={q.error} title="Couldn’t load maintenance data" onRetry={() => q.refetch()} />;
  if (q.isPending) return skeleton ? <Skeleton kind="table" rows={5} label="Loading maintenance" /> : null;
  const data = q.data;
  const stats = data.db_stats;
  const failed = 'error' in stats;
  const active = data.jobs.some((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
  return (
    <Stack gap="xl">
      <section>
        <SectionHeader
          title="Database"
          description={`Statistics refreshed ${Math.round(data.db_stats_age_seconds)} s ago`}
          aside={
            <Button
              variant="neutral"
              loading={refresh.isPending}
              onPress={() =>
                refresh.mutate(undefined, { onError: () => toast.show('Refresh failed', { tone: 'error' }) })
              }
            >
              Refresh
            </Button>
          }
        />
        <MaintenanceSummary data={data} />
        {failed ? (
          <div className={styles.statsError} role="status" data-stats-error>
            Table statistics are unavailable (they need PostgreSQL). Jobs still work.{' '}
            <code>{stats.error}</code>
          </div>
        ) : (
          <div className={styles.tables}>
            <DataTable
              density="compact"
              densityLocked
              aria-label="Largest tables"
              columns={TABLE_COLS}
              rows={stats.tables ?? []}
              rowKey={(r) => r.table}
              storageKey="admin-db-tables"
              empty="No table statistics."
            />
            <DataTable
              density="compact"
              densityLocked
              aria-label="Run events by type"
              columns={EVENT_COLS}
              rows={stats.run_events_by_type ?? []}
              rowKey={(r) => r.type}
              storageKey="admin-db-events"
              empty="No run events."
            />
          </div>
        )}
      </section>
      <section>
        <SectionHeader
          title="Maintenance jobs"
          description="Run in the worker in small committed steps and survive restarts. Irreversible jobs require typing their name."
          aside={
            active ? (
              <Text variant="sm" tone="muted" role="status">
                Refreshing every 3 s while jobs are active
              </Text>
            ) : undefined
          }
        />
        <Stack gap="md">
          <EnqueueJobForm kinds={data.job_kinds} />
          <JobsTable jobs={data.jobs} />
        </Stack>
      </section>
    </Stack>
  );
}
