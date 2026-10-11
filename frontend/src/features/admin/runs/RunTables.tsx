import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { AdminRunSummary } from '@/api/admin';
import { runPath } from '@/app/routes';
import { Badge, Button, DataTable, RunStatusBadge, type Column, type RunStatus } from '@/ui';
import { ownerLabel, progressLabel, projectLabel, relativeTime, runName } from '../format';
import styles from './runs.module.css';

function runHref(run: AdminRunSummary): string {
  return run.project?.slug ? runPath(run.project.slug, run.run_id) : `/run/${encodeURIComponent(run.run_id)}`;
}

function RunCell({ run }: { run: AdminRunSummary }) {
  return (
    <span className={styles.runCell}>
      <Link to={runHref(run)} className={styles.runLink}>
        {runName(run)}
      </Link>
      {run.task_name ? <span className={styles.meta}>{run.task_name}</span> : null}
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
  /** Live table: pulsing status + progress; recent: status badge + items. */
  variant: 'live' | 'recent';
}

function ForceStopCell({ run, stopping, onForceStop }: { run: AdminRunSummary; stopping: boolean; onForceStop?: (r: AdminRunSummary) => void }) {
  if (!run.can_force_stop || !onForceStop) return null;
  return (
    <Button
      variant="ghost"
      onPress={() => onForceStop(run)}
      isDisabled={stopping}
      loading={stopping}
      aria-label={`Force stop ${runName(run)}`}
      className={styles.stopButton}
      data-force-stop={run.run_id}
    >
      {stopping ? 'Stopping…' : 'Force stop'}
    </Button>
  );
}

export function RunTable({ runs, stoppingIds, onForceStop, emptyState, storageKey, variant, 'aria-label': label }: RunTableProps) {
  const columns = useMemo<Column<AdminRunSummary>[]>(
    () => [
      { id: 'project', label: 'Project', width: 170, cell: (r) => <span className={styles.project}>{projectLabel(r)}</span> },
      { id: 'run', label: 'Run', flex: true, minWidth: 160, cell: (r) => <RunCell run={r} /> },
      { id: 'owner', label: 'Owner', width: 140, cell: (r) => ownerLabel(r) },
      {
        id: 'status',
        label: 'Status',
        width: 130,
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
        label: variant === 'live' ? 'Progress' : 'Items',
        width: 90,
        mono: true,
        align: 'end',
        cell: (r) => progressLabel(r),
      },
      {
        id: 'updated',
        label: variant === 'live' ? 'Updated' : 'Created',
        width: 100,
        cell: (r) => <span className={styles.meta}>{relativeTime(variant === 'live' ? (r.last_event_at ?? r.timestamp) : (r.timestamp ?? r.last_event_at))}</span>,
      },
      {
        id: 'actions',
        label: 'Actions',
        hideLabel: true,
        width: 110,
        resizable: false,
        align: 'end',
        cell: (r) => <ForceStopCell run={r} stopping={Boolean(stoppingIds?.has(r.run_id))} onForceStop={onForceStop} />,
      },
    ],
    [variant, stoppingIds, onForceStop],
  );
  return <DataTable aria-label={label} columns={columns} rows={runs} rowKey={(r) => r.run_id} storageKey={storageKey} emptyState={emptyState} />;
}
