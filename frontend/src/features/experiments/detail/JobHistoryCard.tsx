/** Every job, current attempts first; earlier (superseded) attempts on demand. */
import { Link } from 'react-router-dom';
import type { ExperimentDetail, ExperimentJob } from '@/api/experiments';
import { runPath } from '@/app/routes';
import {
  Checkbox,
  DataTable,
  RelativeTime,
  SectionHeader,
  TwoLine,
  type Column,
  type RowAction,
  Card,
} from '@/ui';
import { JobStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { sweepSummary } from '../lib/format';
import type { ExperimentFlows } from './useExperimentFlows';
import styles from './detail.module.css';

export interface JobHistoryCardProps {
  slug: string;
  detail: ExperimentDetail;
  showEarlier: boolean;
  onShowEarlier: (on: boolean) => void;
  flows: ExperimentFlows;
  canControl: boolean;
  live: boolean;
}

export function JobHistoryCard({
  slug,
  detail,
  showEarlier,
  onShowEarlier,
  flows,
  canControl,
  live,
}: JobHistoryCardProps) {
  const supersededCount = detail.jobs.filter((j) => j.superseded).length;
  const rows = showEarlier ? detail.jobs : detail.jobs.filter((j) => !j.superseded);
  const columns: Column<ExperimentJob>[] = [
    {
      id: 'combo',
      header: 'Combo',
      type: 'id',
      width: 80,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (j) => (
        <span data-job-id={j.id} className={j.superseded ? styles.superseded : undefined}>
          #{j.combo_index}
        </span>
      ),
    },
    {
      id: 'environment',
      header: 'Environment',
      width: 150,
      priority: 2,
      cell: (j) => <span className={styles.truncate}>{j.environment_name || j.environment_id}</span>,
    },
    {
      id: 'params',
      header: 'Params',
      width: 220,
      flex: true,
      priority: 3,
      cell: (j) => {
        const text = sweepSummary(j, detail.sweep_keys);
        return (
          <span className={`${styles.truncate} ${styles.mono}`} title={text}>
            {text || '—'}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 200,
      priority: 1,
      cell: (j) => (
        <TwoLine
          primary={<JobStatusBadge status={j.status} />}
          secondary={
            j.error ? (
              <span className={styles.errorText} title={j.error}>
                {j.error}
              </span>
            ) : j.wait_reason && isCancellable(j) ? (
              j.wait_reason
            ) : undefined
          }
        />
      ),
    },
    {
      id: 'attempt',
      header: 'Attempt',
      type: 'number',
      width: 90,
      priority: 3,
      cell: (j) => <TwoLine primary={j.attempt + 1} secondary={j.superseded ? 'retried' : undefined} />,
    },
    {
      id: 'run',
      header: 'Run',
      width: 180,
      priority: 2,
      cell: (j) =>
        j.run_id && !j.run?.deleted ? (
          <TwoLine
            primary={
              <Link className={styles.runLink} to={runPath(slug, j.run_id)} title={j.run_name || j.run_id}>
                <span className={styles.truncate}>{j.run_name || j.run_id}</span>
              </Link>
            }
            secondary={j.run?.status ? `Run ${j.run.status.toLowerCase()}` : undefined}
          />
        ) : (
          <TwoLine primary={j.run_id ? 'Deleted' : '—'} secondary={j.run_name || undefined} />
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      type: 'date',
      width: 110,
      priority: 2,
      cell: (j) => <RelativeTime iso={j.finished_at || j.updated_at || j.created_at} />,
    },
  ];
  const rowActions = (j: ExperimentJob): RowAction<ExperimentJob>[] => [
    ...(isCancellable(j)
      ? [
          {
            id: 'cancel',
            label: `Cancel job #${j.combo_index} on ${j.environment_name ?? 'environment'}`,
            icon: 'close',
            primary: true,
            danger: true,
            disabled: !canControl || flows.busy.has(j.id),
            onPress: flows.cancelJob,
          },
        ]
      : []),
    ...(isRetryable(j)
      ? [
          {
            id: 'retry',
            label: `Retry job #${j.combo_index} on ${j.environment_name ?? 'environment'}`,
            icon: 'retry',
            primary: true,
            disabled: !canControl || flows.busy.has(j.id),
            onPress: flows.retryJob,
          },
        ]
      : []),
  ];
  return (
    <Card as="section" aria-labelledby="history-title" data-exp-jobs>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <SectionHeader
            id="history-title"
            title="Job history"
            description={
              live ? 'Refreshing automatically while jobs are queued or running.' : 'Every job has finished.'
            }
          />
          {supersededCount ? (
            <Checkbox isSelected={showEarlier} onChange={onShowEarlier}>
              Show earlier attempts ({supersededCount})
            </Checkbox>
          ) : null}
        </div>
        <DataTable<ExperimentJob>
          aria-label="Jobs"
          storageKey="experiments.jobs.v1"
          columns={columns}
          rows={rows}
          rowKey={(j) => j.id}
          minWidth={1000}
          empty="This experiment has no jobs."
          rowActions={rowActions}
          rowState={(j) => (j.status === 'FAILED' || j.status === 'TIMED_OUT' ? 'error' : undefined)}
          density="regular"
          refreshing={live}
        >
          <DataTable.Footer summary={`${rows.length} ${rows.length === 1 ? 'job' : 'jobs'}`} />
        </DataTable>
      </div>
    </Card>
  );
}
