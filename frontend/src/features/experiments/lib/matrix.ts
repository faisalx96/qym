/** Combination x environment matrix model for the experiment detail page (pure). */
import type { ExperimentDetail, ExperimentJob, JobQymConfig } from '@/api/experiments';
import { isTerminalJob } from '@/api/experiments';
import { formatParam } from './format';

export interface MatrixEnv {
  id: string;
  name: string;
  active: boolean;
}

export interface MatrixCombo {
  index: number;
  label: string;
  sweep: Record<string, unknown>;
}

export interface MatrixCell {
  /** The latest (non-superseded) attempt. */
  current: ExperimentJob | null;
  /** Superseded attempts of the same combination and environment. */
  earlier: ExperimentJob[];
}

export interface Matrix {
  envs: MatrixEnv[];
  combos: MatrixCombo[];
  cells: Map<string, MatrixCell>;
  /** Run ids of current attempts whose run exists and is not deleted. */
  liveRunIds: string[];
}

export const cellKey = (comboIndex: number, envId: string) => `${comboIndex}|${envId}`;

/** A run exists and was not deleted. */
export function usableRun(job: ExperimentJob | null | undefined): boolean {
  return Boolean(job && job.run_id && !(job.run && job.run.deleted));
}

export function currentJobs(detail: Pick<ExperimentDetail, 'jobs'>): ExperimentJob[] {
  return detail.jobs.filter((j) => !j.superseded);
}

export function buildMatrix(detail: ExperimentDetail): Matrix {
  const byIndex = new Map<number, MatrixCombo>();
  const cells = new Map<string, MatrixCell>();
  for (const job of detail.jobs) {
    let combo = byIndex.get(job.combo_index);
    if (!combo) {
      combo = { index: job.combo_index, label: '', sweep: {} };
      byIndex.set(job.combo_index, combo);
    }
    if (job.combo_label && !combo.label) combo.label = job.combo_label;
    const sweep = job.params?.sweep;
    if (sweep && typeof sweep === 'object' && !Object.keys(combo.sweep).length) combo.sweep = sweep;
    const key = cellKey(job.combo_index, job.environment_id);
    const cell = cells.get(key) ?? { current: null, earlier: [] };
    if (job.superseded) cell.earlier.push(job);
    else cell.current = job;
    cells.set(key, cell);
  }
  const envs: MatrixEnv[] = (detail.environments ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    active: e.is_active !== false,
  }));
  for (const job of detail.jobs) {
    if (!envs.some((e) => e.id === job.environment_id)) {
      envs.push({ id: job.environment_id, name: job.environment_name || job.environment_id, active: true });
    }
  }
  const combos = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const liveRunIds = currentJobs(detail)
    .filter(usableRun)
    .map((j) => j.run_id as string);
  return { envs, combos, cells, liveRunIds };
}

/** Keep only selected runs that are still comparable (selection survives polls). */
export function pruneSelection(selected: ReadonlySet<string>, liveRunIds: readonly string[]): string[] {
  return liveRunIds.filter((id) => selected.has(id));
}

export interface JobStats {
  jobs: number;
  succeeded: number;
  failed: number;
  inProgress: number;
  cancelled: number;
}

/** Stat strip numbers: current attempts only. */
export function jobStats(detail: Pick<ExperimentDetail, 'jobs'>): JobStats {
  const stats: JobStats = { jobs: 0, succeeded: 0, failed: 0, inProgress: 0, cancelled: 0 };
  for (const job of currentJobs(detail)) {
    stats.jobs += 1;
    if (job.status === 'SUCCEEDED') stats.succeeded += 1;
    else if (job.status === 'FAILED' || job.status === 'TIMED_OUT') stats.failed += 1;
    else if (job.status === 'CANCELLED') stats.cancelled += 1;
    else if (!isTerminalJob(job.status)) stats.inProgress += 1;
  }
  return stats;
}

/** `/compare?runs=a&runs=b` (the page also reads sessionStorage `compareRuns`). */
export function compareHref(runIds: readonly string[]): string {
  return `/compare?${runIds.map((id) => `runs=${encodeURIComponent(id)}`).join('&')}`;
}

const PRESET_KEYS = ['schema_hash', 'evaluator', 'slot_bindings', 'env_overrides'] as const;

/** The secret-free config a saved preset keeps (the job's qym_config without its sweep). */
export function presetConfig(job: Pick<ExperimentJob, 'qym_config'>): Record<string, unknown> {
  const source: JobQymConfig = job.qym_config ?? {};
  const config: Record<string, unknown> = {};
  for (const key of PRESET_KEYS)
    if (source[key] !== undefined && source[key] !== null) config[key] = source[key];
  return config;
}

/** `model (slot)` for every temporary model in a config: they are saved without keys. */
export function temporaryModels(config: Record<string, unknown>): string[] {
  const bindings = (config.slot_bindings ?? {}) as Record<string, unknown>;
  return Object.entries(bindings)
    .filter(([, v]) => v && typeof v === 'object' && (v as Record<string, unknown>).temporary)
    .map(([slot, v]) => `${formatParam(v)} (${slot})`);
}

export function defaultPresetName(experimentName: string, job: Pick<ExperimentJob, 'combo_label'>): string {
  const label = job.combo_label ? ` · ${job.combo_label}` : '';
  return `${experimentName || 'Experiment'}${label}`.slice(0, 200);
}

export interface QueueStripRow {
  environmentId: string;
  environmentName: string;
  queued: number;
  running: number;
  blocked: number;
  /** Lowest dispatch position among this experiment's queued jobs (null when none has one). */
  position: number | null;
}

const RUNNING_STATUSES = ['SUBMITTING', 'SUBMITTED', 'RUNNING', 'CANCELLING'];

/** Per-environment counts for the strip above the matrix; empty when nothing is live. */
export function buildQueueStrip(
  jobs: {
    environment_id: string;
    environment_name: string | null;
    status: string;
    queue_position: number | null;
  }[],
): QueueStripRow[] {
  const rows = new Map<string, QueueStripRow>();
  for (const job of jobs) {
    const live = job.status === 'QUEUED' || job.status === 'BLOCKED' || RUNNING_STATUSES.includes(job.status);
    if (!live) continue;
    const row = rows.get(job.environment_id) ?? {
      environmentId: job.environment_id,
      environmentName: job.environment_name || job.environment_id,
      queued: 0,
      running: 0,
      blocked: 0,
      position: null,
    };
    if (job.status === 'QUEUED') row.queued += 1;
    else if (job.status === 'BLOCKED') row.blocked += 1;
    else row.running += 1;
    if (job.queue_position != null && (row.position === null || job.queue_position < row.position))
      row.position = job.queue_position;
    rows.set(job.environment_id, row);
  }
  return [...rows.values()];
}
