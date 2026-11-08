/**
 * Combination x environment matrix: each cell is the latest attempt of that job (C138, E2). A cell shows its status
 * mark, the score in large type (a link to the run) and, like a runs-list row (owner answer, Nov 1), one '>' handle
 * that opens one menu with every cell action, each with its action tile: Open run, Retry (failed cells), Cancel
 * (live cells), Save as preset and Promote to default preset.
 */
import { Link, useNavigate } from 'react-router-dom';
import type { ExperimentJob } from '@/api/experiments';
import { runPath } from '@/app/routes';
import {
  ActionTile,
  Button,
  Checkbox,
  RowMenu,
  SectionHeader,
  Card,
  ScoreValue,
  type MenuItemSpec,
} from '@/ui';
import { JobStatusBadge } from '../components/StatusBadges';
import { isCancellable, isRetryable } from '../lib/cancel';
import { formatMetric, plural } from '../lib/format';
import { cellKey, usableRun, type Matrix, type MatrixEnv } from '../lib/matrix';
import type { ExperimentFlows } from './useExperimentFlows';
import styles from './detail.module.css';

export interface MatrixCardProps {
  slug: string;
  matrix: Matrix;
  selected: string[];
  onToggle: (runId: string, on: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCompare: () => void;
  onShowAttempts: (job: ExperimentJob) => void;
  flows: ExperimentFlows;
  canControl: boolean;
  /** Any project member may save a job's configuration as a preset (the server only asks for access). */
  canSavePreset: boolean;
  canPromote: boolean;
  onPromote: (job: ExperimentJob) => void;
}

export function MatrixCard({
  slug,
  matrix,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  onCompare,
  onShowAttempts,
  flows,
  canControl,
  canSavePreset,
  canPromote,
  onPromote,
}: MatrixCardProps) {
  const { envs, combos, rows, cells, liveRunIds } = matrix;
  const byDataset = rows.length > combos.length;
  const selectedSet = new Set(selected);
  return (
    <Card as="section" aria-labelledby="matrix-title" data-exp-matrix>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <SectionHeader
            id="matrix-title"
            title="Matrix"
            description={`${plural(combos.length, 'combination')} × ${plural(envs.length, 'environment')}${byDataset ? ', one row per dataset version where an environment ran them one by one' : ''}. Each cell is the latest attempt; earlier attempts stay in the job history.`}
          />
          <div className={styles.toolbar} role="group" aria-label="Compare runs">
            <Button
              variant="neutral"
              isDisabled={!liveRunIds.length || selected.length === liveRunIds.length}
              onPress={onSelectAll}
            >
              Select all runs
            </Button>
            <Button variant="neutral" isDisabled={!selected.length} onPress={onClear}>
              Clear
            </Button>
            <Button variant="accent" isDisabled={selected.length < 2} onPress={onCompare}>
              Compare selected ({selected.length})
            </Button>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.matrix}>
            <caption className={styles.srOnly}>
              Latest attempt of each combination in each environment
            </caption>
            <thead>
              <tr>
                <th scope="col">Combination</th>
                {envs.map((env) => (
                  <th key={env.id} scope="col" title={env.name}>
                    {env.name}
                    {env.active ? '' : ' (disabled)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  data-combo-index={row.combo.index}
                  data-dataset-row={byDataset ? row.key : undefined}
                >
                  <th scope="row">
                    <span className={styles.comboLabel} title={row.label || row.combo.label}>
                      {row.label ||
                        row.combo.label ||
                        (combos.length === 1 ? 'Configuration' : 'Combination')}
                    </span>
                    <span className={`${styles.sub} ${styles.mono}`}>{row.sub}</span>
                  </th>
                  {envs.map((env) => {
                    const cell = cells.get(cellKey(row.key, env.id));
                    const comboLabel = row.label || row.combo.label || `#${row.combo.index}`;
                    return (
                      <td key={env.id}>
                        {cell?.current ? (
                          <MatrixCell
                            slug={slug}
                            job={cell.current}
                            earlier={cell.earlier.length}
                            env={env}
                            comboLabel={comboLabel}
                            selected={cell.current.run_id ? selectedSet.has(cell.current.run_id) : false}
                            onToggle={onToggle}
                            onShowAttempts={onShowAttempts}
                            flows={flows}
                            canControl={canControl}
                            canSavePreset={canSavePreset}
                            canPromote={canPromote}
                            onPromote={onPromote}
                          />
                        ) : (
                          <span className={styles.sub}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

interface CellProps {
  slug: string;
  job: ExperimentJob;
  earlier: number;
  env: MatrixEnv;
  comboLabel: string;
  selected: boolean;
  onToggle: (runId: string, on: boolean) => void;
  onShowAttempts: (job: ExperimentJob) => void;
  flows: ExperimentFlows;
  canControl: boolean;
  /** Any project member may save a job's configuration as a preset (the server only asks for access). */
  canSavePreset: boolean;
  canPromote: boolean;
  onPromote: (job: ExperimentJob) => void;
}

function MatrixCell({
  slug,
  job,
  earlier,
  env,
  comboLabel,
  selected,
  onToggle,
  onShowAttempts,
  flows,
  canControl,
  canSavePreset,
  canPromote,
  onPromote,
}: CellProps) {
  const navigate = useNavigate();
  const headline = job.run?.headline_metric;
  const busy = flows.busy.has(job.id);
  const runId = usableRun(job) && job.run_id ? job.run_id : null;
  const presetReason = !job.qym_config
    ? 'This job has no stored configuration'
    : !env.active
      ? 'The environment is disabled'
      : null;
  const items: MenuItemSpec[] = [];
  if (runId) items.push({ id: 'open', label: 'Open run', icon: <ActionTile icon="file" /> });
  if (isRetryable(job))
    items.push({
      id: 'retry',
      label: 'Retry',
      icon: <ActionTile icon="retry" />,
      disabled: !canControl || busy,
    });
  items.push({
    id: 'save',
    label: 'Save as preset',
    icon: <ActionTile icon="star" />,
    disabled: Boolean(presetReason) || !canSavePreset,
    description: presetReason ?? undefined,
  });
  if (canPromote)
    items.push({
      id: 'promote',
      label: 'Promote to default preset',
      icon: <ActionTile icon="upload" />,
      disabled: Boolean(presetReason),
      description: presetReason ?? undefined,
    });
  if (isCancellable(job))
    items.push({
      id: 'cancel',
      label: 'Cancel',
      tone: 'danger',
      separatorBefore: true,
      icon: <ActionTile icon="stop" tone="danger" />,
      disabled: !canControl || busy,
    });
  const onAction = (id: string) => {
    if (id === 'open' && runId) navigate(runPath(slug, runId));
    else if (id === 'retry') flows.retryJob(job);
    else if (id === 'cancel') flows.cancelJob(job);
    else if (id === 'save') flows.savePreset(job);
    else if (id === 'promote') onPromote(job);
  };
  const value = headline && typeof headline.mean === 'number' ? formatMetric(headline.mean) : null;
  // A 0-1 score reads as a percent in its band colour (C048); the score opens the run (E2).
  const score =
    value && headline ? (
      headline.mean >= 0 && headline.mean <= 1 ? (
        <ScoreValue
          value={headline.mean}
          direction={headline.direction === 'minimize' ? 'minimize' : 'maximize'}
          digits={1}
          variant="plain"
          className={styles.metricValue}
        />
      ) : (
        <span className={styles.metricValue}>{value}</span>
      )
    ) : null;
  return (
    <div className={styles.cell} data-exp-cell={job.id}>
      <div className={styles.cellTop}>
        {runId ? (
          <Checkbox isSelected={selected} onChange={(on) => onToggle(runId, on)} hideLabel>
            {`Select run for ${comboLabel} on ${env.name}`}
          </Checkbox>
        ) : null}
        <JobStatusBadge status={job.status} />
        {earlier ? (
          <button
            type="button"
            className={styles.earlier}
            title="Show earlier attempts in the job history"
            onClick={() => onShowAttempts(job)}
          >
            ↻ {earlier} earlier
          </button>
        ) : null}
        <span className={styles.cellMenu}>
          <RowMenu label={`Actions: ${comboLabel} on ${env.name}`} items={items} onAction={onAction} />
        </span>
      </div>
      {value && headline ? (
        <div className={styles.metric}>
          {runId ? (
            <Link
              className={`${styles.metricValue} ${styles.metricLink}`}
              to={runPath(slug, runId)}
              title={`Open ${job.run_name || runId}`}
            >
              {score}
            </Link>
          ) : (
            score
          )}
          <span
            className={styles.metricName}
            title={headline.name + (headline.direction === 'minimize' ? ' (lower is better)' : '')}
          >
            {headline.name}
          </span>
        </div>
      ) : null}
      {!runId && job.run_id ? <span className={styles.sub}>Run deleted</span> : null}
      {job.error ? (
        <span className={`${styles.sub} ${styles.errorText}`} title={job.error}>
          {job.error}
        </span>
      ) : job.wait_reason && isCancellable(job) ? (
        <span className={styles.sub}>{job.wait_reason}</span>
      ) : null}
    </div>
  );
}
