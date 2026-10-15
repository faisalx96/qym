/** Combination x environment matrix: each cell is the latest attempt of that job. */
import { Link } from 'react-router-dom';
import type { ExperimentJob } from '@/api/experiments';
import { runPath } from '@/app/routes';
import { Button, Checkbox, SectionHeader, Card } from '@/ui';
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
  const { envs, combos, cells, liveRunIds } = matrix;
  const selectedSet = new Set(selected);
  return (
    <Card as="section" aria-labelledby="matrix-title" data-exp-matrix>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <SectionHeader
            id="matrix-title"
            title="Matrix"
            description={`${plural(combos.length, 'combination')} × ${plural(envs.length, 'environment')}. Each cell is the latest attempt; earlier attempts stay in the job history.`}
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
        <Card flush className={styles.tableWrap}>
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
              {combos.map((combo) => (
                <tr key={combo.index} data-combo-index={combo.index}>
                  <th scope="row">
                    <span className={styles.comboLabel} title={combo.label}>
                      {combo.label || (combos.length === 1 ? 'Configuration' : 'Combination')}
                    </span>
                    <span className={`${styles.sub} ${styles.mono}`}>#{combo.index}</span>
                  </th>
                  {envs.map((env) => {
                    const cell = cells.get(cellKey(combo.index, env.id));
                    return (
                      <td key={env.id}>
                        {cell?.current ? (
                          <MatrixCell
                            slug={slug}
                            job={cell.current}
                            earlier={cell.earlier.length}
                            env={env}
                            comboLabel={combo.label || `#${combo.index}`}
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
        </Card>
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
  const headline = job.run?.headline_metric;
  const busy = flows.busy.has(job.id);
  const noConfig = !job.qym_config;
  const presetReason = noConfig
    ? 'This job has no stored configuration'
    : !env.active
      ? 'The environment is disabled'
      : null;
  return (
    <div className={styles.cell} data-exp-cell={job.id}>
      <div className={styles.cellTop}>
        {usableRun(job) && job.run_id ? (
          <Checkbox isSelected={selected} onChange={(on) => onToggle(job.run_id as string, on)} hideLabel>
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
      </div>
      {headline && typeof headline.mean === 'number' ? (
        <div className={styles.metric}>
          <span className={styles.metricValue}>{formatMetric(headline.mean)}</span>
          <span
            className={styles.metricName}
            title={headline.name + (headline.direction === 'minimize' ? ' (lower is better)' : '')}
          >
            {headline.name}
          </span>
        </div>
      ) : null}
      {usableRun(job) && job.run_id ? (
        <Link className={styles.runLink} to={runPath(slug, job.run_id)} title={job.run_name || job.run_id}>
          {job.run_name || job.run_id}
        </Link>
      ) : job.run_id ? (
        <span className={styles.sub}>Run deleted</span>
      ) : null}
      {job.error ? (
        <span className={`${styles.sub} ${styles.errorText}`} title={job.error}>
          {job.error}
        </span>
      ) : job.wait_reason && isCancellable(job) ? (
        <span className={styles.sub}>{job.wait_reason}</span>
      ) : null}
      <div className={styles.cellActions}>
        {isCancellable(job) ? (
          <Button
            variant="danger"
            isDisabled={!canControl || busy}
            onPress={() => flows.cancelJob(job)}
            aria-label={`Cancel ${comboLabel} on ${env.name}`}
            data-exp-job-cancel={job.id}
          >
            Cancel
          </Button>
        ) : null}
        {isRetryable(job) ? (
          <Button
            variant="neutral"
            isDisabled={!canControl || busy}
            loading={busy}
            onPress={() => flows.retryJob(job)}
            aria-label={`Retry ${comboLabel} on ${env.name}`}
            data-exp-job-retry={job.id}
          >
            Retry
          </Button>
        ) : null}
        <Button
          variant="neutral"
          isDisabled={Boolean(presetReason) || !canSavePreset}
          onPress={() => flows.savePreset(job)}
          aria-label={`Save as preset: ${comboLabel} on ${env.name}`}
          data-exp-save-preset={job.id}
        >
          Save as preset
        </Button>
        {canPromote ? (
          <Button
            variant="neutral"
            isDisabled={Boolean(presetReason)}
            onPress={() => onPromote(job)}
            aria-label={`Promote to default preset: ${comboLabel} on ${env.name}`}
            data-exp-promote={job.id}
          >
            Promote to default preset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
