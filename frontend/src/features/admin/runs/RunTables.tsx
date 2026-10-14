import { useMemo } from 'react';
import type { AdminRunSummary } from '@/api/admin';
import { runPath } from '@/app/routes';
import {
  Badge,
  DataTable,
  RunName,
  RunStatusBadge,
  TaskTag,
  type Column,
  type PaginationProps,
  type RunStatus,
} from '@/ui';
import { ownerLabel, progressLabel, projectLabel, relativeTime, runName } from '../format';
import styles from './runs.module.css';

function runHref(run: AdminRunSummary): string {
  return run.project?.slug ? runPath(run.project.slug, run.run_id) : `/run/${encodeURIComponent(run.run_id)}`;
}

function RunCell({ run }: { run: AdminRunSummary }) {
  return (
    <span className={styles.runInline} data-testid="admin-run-cell">
      <RunName to={runHref(run)} name={runName(run)} runId={run.run_id} />
      {run.task_name ? <TaskTag name={run.task_name} /> : null}
    </span>
  );
}

export interface RunTableProps {
  runs: AdminRunSummary[];
  /** Runs whose stop is in flight (button shows "Stopping…"). */
  stoppingIds?: Set<string>;
  onForceStop?: (run: AdminRunSummary) => void;
  emptyState: string;
  storageKey: string;
  'aria-label': string;
  footerSummary?: string;
  pagination?: PaginationProps;
  /** Live table: pulsing status + progress; recent: status badge + items. */
  variant: 'live' | 'recent';
}

export function RunTable({
  runs,
  stoppingIds,
  onForceStop,
  emptyState,
  storageKey,
  variant,
  footerSummary,
  pagination,
  'aria-label': label,
}: RunTableProps) {
  const columns = useMemo<Column<AdminRunSummary>[]>(
    () => [
      {
        id: 'project',
        header: 'Project',
        width: 170,
        priority: 2,
        cell: (r) => <span className={styles.project}>{projectLabel(r)}</span>,
      },
      {
        id: 'run',
        header: 'Run',
        flex: true,
        minWidth: 160,
        pin: 'start',
        hideable: false,
        priority: 1,
        cell: (r) => <RunCell run={r} />,
      },
      { id: 'owner', header: 'Owner', width: 140, priority: 3, cell: (r) => ownerLabel(r) },
      {
        id: 'status',
        header: 'Status',
        type: 'status',
        width: 130,
        priority: 1,
        cell: (r) =>
          variant === 'live' ? (
            <Badge tone="info" dot>
              {r.status || 'RUNNING'}
            </Badge>
          ) : (
            <RunStatusBadge status={r.status as RunStatus} />
          ),
      },
      {
        id: 'progress',
        header: variant === 'live' ? 'Progress' : 'Items',
        type: 'number',
        width: 90,
        priority: 2,
        cell: (r) => progressLabel(r, variant),
      },
      {
        id: 'updated',
        header: variant === 'live' ? 'Updated' : 'Created',
        type: 'date',
        width: 100,
        priority: 2,
        cell: (r) => (
          <span className={styles.meta}>
            {relativeTime(
              variant === 'live' ? (r.last_event_at ?? r.timestamp) : (r.timestamp ?? r.last_event_at),
            )}
          </span>
        ),
      },
    ],
    [variant],
  );
  return (
    <DataTable<AdminRunSummary>
      aria-label={label}
      columns={columns}
      rows={runs}
      rowKey={(r) => r.run_id}
      storageKey={storageKey}
      density="comfortable"
      empty={emptyState}
      rowActions={(r) =>
        !r.can_force_stop || !onForceStop || /^(STOPPED|COMPLETED|FAILED)$/i.test(r.status)
          ? []
          : [
              {
                id: 'force-stop',
                label: stoppingIds?.has(r.run_id) ? `Stopping ${runName(r)}` : `Force stop ${runName(r)}`,
                icon: 'stop',
                primary: true,
                danger: true,
                disabled: Boolean(stoppingIds?.has(r.run_id)),
                onPress: onForceStop,
              },
            ]
      }
      rowState={(r) => (variant === 'live' ? 'live' : /^FAILED$/i.test(r.status) ? 'error' : undefined)}
    >
      <DataTable.Footer summary={footerSummary} pagination={pagination} />
    </DataTable>
  );
}
