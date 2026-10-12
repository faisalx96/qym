/** Every job, current attempts first; earlier (superseded) attempts on demand. */
import { Link } from 'react-router-dom';
import type { ExperimentDetail, ExperimentJob } from '@/api/experiments';
import { runPath } from '@/app/routes';
import { Button, Checkbox, DataTable, SectionHeader, type Column } from '@/ui';
import { JobStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { absTime, relTime, sweepSummary } from '../lib/format';
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
      label: 'Combo',
      width: 80,
      mono: true,
      cell: (j) => (
        <span data-job-id={j.id} className={j.superseded ? styles.superseded : undefined}>
          #{j.combo_index}
        </span>
      ),
    },
    {
      id: 'environment',
      label: 'Environment',
      width: 150,
      cell: (j) => <span className={styles.truncate}>{j.environment_name || j.environment_id}</span>,
    },
    {
      id: 'params',
      label: 'Params',
      width: 220,
      flex: true,
      mono: true,
      cell: (j) => {
        const text = sweepSummary(j, detail.sweep_keys);
        return (
          <span className={styles.truncate} title={text}>
            {text || '—'}
          </span>
        );
      },
    },
    {
      id: 'status',
      label: 'Status',
      width: 200,
      cell: (j) => (
        <div>
          <JobStatusBadge status={j.status} />
          {j.error ? (
            <span className={`${styles.sub} ${styles.errorText}`} title={j.error}>
              {j.error}
            </span>
          ) : j.wait_reason && isCancellable(j) ? (
            <span className={styles.sub}>{j.wait_reason}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'attempt',
      label: 'Attempt',
      width: 90,
      mono: true,
      cell: (j) => (
        <div>
          {j.attempt + 1}
          {j.superseded ? <span className={styles.sub}>retried</span> : null}
        </div>
      ),
    },
    {
      id: 'run',
      label: 'Run',
      width: 180,
      cell: (j) =>
        j.run_id && !j.run?.deleted ? (
          <div>
            <Link className={styles.runLink} to={runPath(slug, j.run_id)} title={j.run_name || j.run_id}>
              <span className={styles.truncate}>{j.run_name || j.run_id}</span>
            </Link>
            {j.run?.status ? <span className={styles.sub}>Run {j.run.status.toLowerCase()}</span> : null}
          </div>
        ) : (
          <div>
            <span>{j.run_id ? 'Deleted' : '—'}</span>
            {j.run_name ? (
              <span className={styles.sub} title={j.run_name}>
                {j.run_name}
              </span>
            ) : null}
          </div>
        ),
    },
    {
      id: 'updated',
      label: 'Updated',
      width: 110,
      mono: true,
      cell: (j) => {
        const at = j.finished_at || j.updated_at || j.created_at;
        return <span title={absTime(at)}>{relTime(at)}</span>;
      },
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 150,
      resizable: false,
      cell: (j) => (
        <div className={styles.rowActions}>
          {isCancellable(j) ? (
            <Button
              variant="danger"
              isDisabled={!canControl || flows.busy.has(j.id)}
              onPress={() => flows.cancelJob(j)}
              aria-label={`Cancel job #${j.combo_index} on ${j.environment_name ?? 'environment'}`}
            >
              Cancel
            </Button>
          ) : null}
          {isRetryable(j) ? (
            <Button
              variant="neutral"
              isDisabled={!canControl || flows.busy.has(j.id)}
              onPress={() => flows.retryJob(j)}
              aria-label={`Retry job #${j.combo_index} on ${j.environment_name ?? 'environment'}`}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <section className={styles.card} aria-labelledby="history-title" data-exp-jobs>
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
      <DataTable
        aria-label="Jobs"
        storageKey="experiments.jobs.v1"
        columns={columns}
        rows={rows}
        rowKey={(j) => j.id}
        minWidth={1000}
        emptyState="This experiment has no jobs."
      />
    </section>
  );
}
