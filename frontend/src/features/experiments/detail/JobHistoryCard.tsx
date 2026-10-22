/** Every job, current attempts first; earlier (superseded) attempts on demand. */
import { useMemo } from 'react';
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
  Tag,
} from '@/ui';
import { JobStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { admissionLine } from '../lib/admission';
import { sweepSummary } from '../lib/format';
import { jobGroup } from '../lib/matrix';
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
  const visible = showEarlier ? detail.jobs : detail.jobs.filter((j) => !j.superseded);
  // With several dataset versions the history is grouped by dataset version, the combined job first.
  const grouped = visible.some((j) => jobGroup(j));
  const rows = useMemo(
    () =>
      grouped
        ? [...visible].sort(
            (a, b) =>
              (jobGroup(a)?.order ?? -2) - (jobGroup(b)?.order ?? -2) ||
              a.combo_index - b.combo_index ||
              (a.environment_name ?? '').localeCompare(b.environment_name ?? '') ||
              a.attempt - b.attempt,
          )
        : visible,
    [grouped, visible],
  );
  const hasTask = detail.jobs.some((j) => j.task);
  const latency = detail.latency_sensitive;
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
    ...(grouped || hasTask
      ? [
          {
            id: 'task',
            header: 'Task',
            width: 170,
            priority: 3,
            cell: (j: ExperimentJob) => (
              <span className={styles.truncate} title={j.task?.id}>
                {j.task?.name ?? 'Worker default'}
              </span>
            ),
          } satisfies Column<ExperimentJob>,
        ]
      : []),
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
      // 240 px for a latency-sensitive experiment: the admission text fits without an ellipsis.
      width: latency ? 240 : 200,
      priority: 1,
      cell: (j) => {
        const line = admissionLine(j, latency);
        return (
          <TwoLine
            primary={
              <span className={styles.jobTitle}>
                <JobStatusBadge status={j.status} />
                {latency && j.contaminated_attempts > 0 ? (
                  <Tag
                    kind="count"
                    tone="info"
                    aria-label={`re-queued ${j.contaminated_attempts} ${j.contaminated_attempts === 1 ? 'time' : 'times'}`}
                    data-testid="requeue-tag"
                  >
                    ↻ {j.contaminated_attempts}
                  </Tag>
                ) : null}
              </span>
            }
            secondary={
              line ? (
                <span
                  className={line.error ? styles.errorText : undefined}
                  title={line.title ?? line.text}
                  data-testid="admission-line"
                >
                  {line.text}
                </span>
              ) : undefined
            }
          />
        );
      },
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
          groupBy={
            grouped
              ? {
                  key: (j) => jobGroup(j)?.key ?? 'plain',
                  label: (key, groupRows) => (
                    <span data-job-group={key}>
                      <Tag kind="dataset">{(groupRows[0] && jobGroup(groupRows[0])?.label) || key}</Tag>
                    </span>
                  ),
                  collapsible: true,
                }
              : undefined
          }
        >
          <DataTable.Footer summary={`${rows.length} ${rows.length === 1 ? 'job' : 'jobs'}`} />
        </DataTable>
      </div>
    </Card>
  );
}
