import { useState } from 'react';
import { useDbStats, useMaintenance, useRefreshMaintenance, type DbStats as DbStatsUnion } from '@/api/admin';
import { formatAgo } from '@/lib/dates';
import { useDelayedPending } from '@/lib/pending';
import { Button, Card, DataTable, ErrorState, Section, Skeleton, Text, useToast, type Column } from '@/ui';
import { formatBytes, formatCount } from '../format';
import { EnqueueJobForm } from './EnqueueJobForm';
import { JobsTable } from './JobsTable';
import { MaintenanceSummary } from './MaintenanceSummary';
import styles from './maintenance.module.css';

type DbStats = Exclude<DbStatsUnion, { error: string }>;
type TableRow = NonNullable<DbStats['tables']>[number];
type EventRow = NonNullable<DbStats['run_events_by_type']>[number];

/** Sizes and counts read in primary text and a zero in muted text, so what matters stands out in a long column. */
function Quiet({ value, text }: { value: number | null | undefined; text: string }) {
  return <span className={value ? styles.value : styles.zero}>{text}</span>;
}
const bytes = (n: number | null | undefined) => <Quiet value={n} text={formatBytes(n)} />;
const count = (n: number | null | undefined) => <Quiet value={n} text={formatCount(n)} />;

const TABLE_COLS: Column<TableRow>[] = [
  {
    id: 'table',
    header: 'Table',
    flex: true,
    minWidth: 140,
    type: 'id',
    cell: (r) => <span className={styles.name}>{r.table}</span>,
  },
  {
    id: 'total',
    header: 'Total',
    width: 80,
    type: 'number',
    cell: (r) => bytes(r.total_bytes),
  },
  { id: 'heap', header: 'Heap', width: 80, type: 'number', cell: (r) => bytes(r.heap_bytes) },
  {
    id: 'toast',
    header: 'TOAST',
    width: 80,
    type: 'number',
    cell: (r) => bytes(r.toast_bytes),
  },
  {
    id: 'index',
    header: 'Indexes',
    width: 80,
    type: 'number',
    cell: (r) => bytes(r.index_bytes),
  },
  {
    id: 'live',
    header: 'Live rows',
    width: 90,
    type: 'number',
    cell: (r) => count(r.live_rows),
  },
  {
    id: 'dead',
    header: 'Dead rows',
    width: 90,
    type: 'number',
    cell: (r) => count(r.dead_rows),
  },
];
const EVENT_COLS: Column<EventRow>[] = [
  {
    id: 'type',
    header: 'Event type',
    flex: true,
    minWidth: 120,
    type: 'id',
    cell: (r) => <span className={styles.name}>{r.type}</span>,
  },
  { id: 'rows', header: 'Rows', width: 90, type: 'number', cell: (r) => count(r.rows) },
  {
    id: 'payload',
    header: 'Payload',
    width: 90,
    type: 'number',
    cell: (r) => bytes(r.payload_bytes),
  },
];

/** The table list opens on the largest tables only; 'Show N more' expands it in place (C093). */
export const LARGEST_TABLES_SHOWN = 10;

/** The statistics tables, loaded on their own: the rest of the tab never waits for them. */
function DbStatsTables({ query }: { query: ReturnType<typeof useDbStats> }) {
  const skeleton = useDelayedPending(query.isPending);
  const [allTables, setAllTables] = useState(false);
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t load the database statistics"
        onRetry={() => void query.refetch()}
        compact
      />
    );
  if (query.isPending)
    return skeleton ? <Skeleton kind="table" rows={8} label="Loading table statistics" /> : null;
  const stats = query.data.db_stats;
  if ('error' in stats)
    return (
      <div className={styles.statsError} role="status" data-stats-error>
        Table statistics are unavailable (they need PostgreSQL). Jobs still work. <code>{stats.error}</code>
      </div>
    );
  const tables = stats.tables ?? [];
  const hidden = tables.length - LARGEST_TABLES_SHOWN;
  return (
    <div className={styles.tables}>
      <DataTable
        density="comfortable"
        densityLocked
        aria-label="Run events by type"
        columns={EVENT_COLS}
        rows={stats.run_events_by_type ?? []}
        rowKey={(r) => r.type}
        storageKey="admin-db-events"
        empty="No run events"
      />
      <DataTable
        density="comfortable"
        densityLocked
        aria-label="Largest tables"
        columns={TABLE_COLS}
        rows={allTables || hidden <= 0 ? tables : tables.slice(0, LARGEST_TABLES_SHOWN)}
        rowKey={(r) => r.table}
        storageKey="admin-db-tables"
        empty="No table statistics"
      >
        {hidden > 0 ? (
          <DataTable.Footer
            filterNote={
              allTables
                ? `All ${tables.length} tables`
                : `${LARGEST_TABLES_SHOWN} largest of ${tables.length} tables`
            }
            center={
              <Button variant="neutral" size="sm" onPress={() => setAllTables((v) => !v)}>
                {allTables ? 'Show fewer' : `Show ${hidden} more`}
              </Button>
            }
          />
        ) : null}
      </DataTable>
    </div>
  );
}

export function MaintenanceTab() {
  const q = useMaintenance();
  const stats = useDbStats();
  const refresh = useRefreshMaintenance();
  const toast = useToast();
  const skeleton = useDelayedPending(q.isPending);
  if (q.isError)
    return <ErrorState error={q.error} title="Couldn’t load maintenance data" onRetry={() => q.refetch()} />;
  if (q.isPending) return skeleton ? <Skeleton kind="table" rows={5} label="Loading maintenance" /> : null;
  const data = q.data;
  const db = stats.data?.db_stats;
  const sizeBytes = !db
    ? stats.isError
      ? null
      : undefined
    : 'error' in db
      ? null
      : (db.database?.size_bytes ?? null);
  const outbox = !db ? (stats.isError ? null : undefined) : 'error' in db ? null : (db.outbox ?? null);
  const active = data.jobs.some((j) => ['queued', 'running', 'cancel_requested'].includes(j.status));
  return (
    <>
      {/* Jobs first: the form is what admins come for; the long table list follows (C093). */}
      <Section
        title="Maintenance jobs"
        description="Jobs run in the worker in small committed steps and survive restarts. Irreversible jobs require typing their name."
        actions={
          active ? (
            <Text variant="sm" tone="muted" role="status">
              Refreshing every 3 s while jobs are active
            </Text>
          ) : undefined
        }
        bodyClassName={styles.jobsBody}
      >
        <Card compact>
          <EnqueueJobForm kinds={data.job_kinds} />
        </Card>
        <JobsTable jobs={data.jobs} />
      </Section>
      <Section
        title="Database"
        description={
          stats.data
            ? `Statistics refreshed ${formatAgo(Date.now() - stats.data.db_stats_age_seconds * 1000)}`
            : stats.isError
              ? 'Statistics unavailable'
              : 'Collecting statistics. This can take a few seconds on a large database.'
        }
        actions={
          <Button
            variant="neutral"
            loading={refresh.isPending}
            isDisabled={stats.isPending}
            onPress={() =>
              refresh.mutate(undefined, { onError: () => toast.show('Refresh failed', { tone: 'error' }) })
            }
          >
            Refresh
          </Button>
        }
        bodyClassName={styles.dbBody}
      >
        <MaintenanceSummary data={data} sizeBytes={sizeBytes} outbox={outbox} />
        <DbStatsTables query={stats} />
      </Section>
    </>
  );
}
