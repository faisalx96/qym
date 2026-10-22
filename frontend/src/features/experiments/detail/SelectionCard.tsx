/** "Datasets and task": what the experiment was launched with. Shown only with several dataset versions or a task. */
import type { ExperimentDetail, ExperimentJob } from '@/api/experiments';
import { Card, KeyValueGrid, Tag } from '@/ui';
import panel from '../launch/components/launch.module.css';
import { currentJobs } from '../lib/matrix';
import { datasetText } from '../lib/matrix';
import styles from './detail.module.css';

/** The card exists when the experiment has a dataset list or any task. */
export function hasSelectionCard(detail: ExperimentDetail): boolean {
  const s = detail.selection;
  return Boolean(s && (s.datasets.length > 1 || Object.keys(s.tasks).length > 0));
}

/** What one environment received: its jobs and the task, in words. */
export function envLine(detail: ExperimentDetail, envId: string): string {
  const jobs = currentJobs(detail).filter((j: ExperimentJob) => j.environment_id === envId);
  const task = detail.selection?.tasks[envId];
  const taskText = task ? `task ${task.name}` : 'Worker default task';
  const combined = jobs.some((j) => j.datasets);
  const pairs = new Set(jobs.filter((j) => j.dataset).map((j) => j.dataset_index ?? 0)).size;
  const olderService = detail.selection?.run_shape === 'combined';
  const what = combined
    ? '1 combined run'
    : pairs
      ? `${pairs} jobs, one per dataset version${olderService ? ' (older Evaluation Service)' : ''}`
      : null;
  return [what, taskText].filter(Boolean).join(' · ');
}

export function SelectionCard({ detail }: { detail: ExperimentDetail }) {
  const s = detail.selection;
  if (!s || !hasSelectionCard(detail)) return null;
  return (
    <Card as="section" aria-label="Datasets and task" tone="meta">
      <div className={panel.cardStack}>
        <KeyValueGrid
          columns={2}
          aria-label="Datasets and task"
          items={[
            {
              key: 'datasets',
              label: 'Datasets',
              value: (
                <span className={styles.refTags} data-testid="detail-datasets">
                  {s.datasets.map((d) => (
                    <Tag key={datasetText(d)} kind="dataset">
                      {datasetText(d)}
                    </Tag>
                  ))}
                </span>
              ),
            },
            ...(s.datasets.length > 1 && s.run_shape
              ? [
                  {
                    key: 'shape',
                    label: 'Run shape',
                    value: s.run_shape === 'combined' ? 'Combine into one run' : 'One run each',
                  },
                ]
              : []),
            {
              key: 'sent',
              label: 'What each environment ran',
              value: (
                <ul className={styles.envLines} data-testid="detail-env-lines">
                  {(detail.environments ?? []).map((env) => (
                    <li key={env.id} className={styles.envLine}>
                      <span className={styles.envLineName}>{env.name}</span>
                      <span className={styles.envLineDetail}>{envLine(detail, env.id)}</span>
                    </li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      </div>
    </Card>
  );
}
