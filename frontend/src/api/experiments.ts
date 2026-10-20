/**
 * Experiments API (brief 06 §4): list, detail (jobs inline), cancel / retry,
 * "Save as preset" and the per-experiment queue strip. Polling follows the logged
 * decision: 5 s x1.5 up to 60 s, only while something is non-terminal, paused while the
 * tab is hidden (`useBackoffInterval`).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { useBackoffInterval } from '@/lib/backoff';
import type { EvalPriority } from './evalCommon';

// ── Types ────────────────────────────────────────────────────────────────

export type ExperimentStatus =
  'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | string;
export const EXPERIMENT_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;
export const LIVE_EXPERIMENT_STATUSES: readonly string[] = ['QUEUED', 'RUNNING'];

export type JobStatus =
  | 'QUEUED'
  | 'BLOCKED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'CANCELLING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | string;
export const TERMINAL_JOB_STATUSES: readonly string[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
export const RETRYABLE_JOB_STATUSES: readonly string[] = ['FAILED', 'CANCELLED', 'TIMED_OUT', 'BLOCKED'];
/** Jobs still held by the platform (never sent to the Evaluation Service). */
export const QUEUED_HERE_STATUSES: readonly string[] = ['QUEUED', 'BLOCKED'];

export const isTerminalJob = (status: string): boolean => TERMINAL_JOB_STATUSES.includes(status);

export interface BaseSource {
  kind: 'official' | 'best_run' | 'saved' | 'blank' | 'clone' | string;
  preset_version_id?: string;
  preset_id?: string;
  experiment_id?: string;
  job_id?: string;
  run_id?: string;
  [key: string]: unknown;
}

export interface Experiment {
  id: string;
  project_id: string;
  name: string;
  description: string;
  environment_ids: string[];
  base_source: BaseSource;
  spec: Record<string, unknown>;
  versioning_details: Record<string, unknown>;
  priority: EvalPriority;
  /** Asks the Evaluation Service for a quiet gateway; immutable after launch. */
  latency_sensitive: boolean;
  preemption_acknowledged_at: string | null;
  status: ExperimentStatus;
  job_count: number;
  job_counts: Record<string, number>;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  temporary_keys_stored: boolean;
}

export interface HeadlineMetric {
  name: string;
  mean: number;
  direction: 'maximize' | 'minimize' | string | null;
}

/** The run a job produced (`run` is null until the service created it). */
export interface JobRun {
  id: string;
  status: string | null;
  status_reason: string | null;
  task: string | null;
  dataset: string | null;
  model: string | null;
  origin: string | null;
  created_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  deleted: boolean;
  metric_means: Record<string, number>;
  headline_metric: HeadlineMetric | null;
}

/** The secret-free configuration snapshot "Save as preset" / "Promote" reuse. */
export interface JobQymConfig {
  schema_hash?: string;
  base_source?: BaseSource;
  evaluator?: Record<string, unknown>;
  slot_bindings?: Record<string, unknown>;
  env_overrides?: Record<string, unknown>;
  sweep?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExperimentJob {
  id: string;
  experiment_id: string;
  environment_id: string;
  environment_name: string | null;
  combo_index: number;
  combo_label: string;
  attempt: number;
  retry_of_job_id: string | null;
  superseded: boolean;
  run_name: string | null;
  params: {
    slot_bindings?: Record<string, unknown>;
    sweep?: Record<string, unknown>;
    [key: string]: unknown;
  };
  schema_id: string | null;
  status: JobStatus;
  remote_job_id: string | null;
  remote_status: string | null;
  remote_result: unknown;
  remote_versioning: unknown;
  error: string | null;
  wait_reason: string | null;
  /** Admission state of a latency-sensitive job, copied from the service on every poll. */
  admitted_at: string | null;
  deferrals: number;
  deferral_reason: string | null;
  contaminated_attempts: number;
  /** `null`: the experiment has no dataset read token; else whether the job's schema takes it. */
  dataset_token: DatasetTokenFlag;
  submit_attempts: number;
  next_attempt_at: string | null;
  submitted_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  cancelled_by_user_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  run_id: string | null;
  run: JobRun | null;
  qym_config: JobQymConfig | null;
}

export type DatasetTokenFlag = 'sent' | 'not_declared' | null;

/** A credential's state only: no prefix, id or secret ever reaches the browser. */
export interface CredentialState {
  state: 'active' | 'revoked' | 'none';
  revoked_at: string | null;
}

export interface ExperimentCredentials {
  api_key: CredentialState;
  dataset_read_token: CredentialState;
}

export interface ExperimentEnvironmentRef {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ExperimentDetail extends Experiment {
  environments: ExperimentEnvironmentRef[];
  ranking_metrics: Record<string, string | null>;
  /** swept JSON pointer -> label */
  sweep_keys: Record<string, string>;
  jobs: ExperimentJob[];
  credentials: ExperimentCredentials;
}

export interface ExperimentListParams {
  status?: string;
  mine?: boolean;
  /** Only latency-sensitive experiments (`latency_sensitive=true`). */
  latency?: boolean;
  /** key -> value, sent as repeated `versioning=key=value` */
  versioning?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export interface ExperimentList {
  experiments: Experiment[];
  total: number;
  limit: number;
  offset: number;
  versioning_facets?: Record<string, string[]>;
}

export type CancelOutcome = 'cancelled' | 'cancelling' | 'already_terminal' | 'forbidden' | string;

export interface CancelExperimentResult {
  outcomes: Record<string, CancelOutcome>;
  skipped_running: string[];
  experiment: ExperimentDetail;
}

export interface CancelJobResult {
  outcome: CancelOutcome;
  experiment: ExperimentDetail;
}

export interface RetryJobResult {
  job_id: string;
  experiment: ExperimentDetail;
}

export interface RetryBody {
  acknowledge_preemption?: boolean;
  /** slot_key -> API key, held only in memory by the caller */
  temporary_keys?: Record<string, string>;
}

/** One entry of a `temporary_key_required` 422 (`detail.slots[]`). */
export interface TemporaryKeySlot {
  slot_key: string;
  label?: string;
  model?: string;
  base_url?: string;
  [key: string]: unknown;
}

export interface SavePresetInput {
  environmentId: string;
  name: string;
  notes?: string | null;
  config: Record<string, unknown>;
}

export interface SavePresetResult {
  preset: { id: string; name: string; [key: string]: unknown };
  warnings: { rule?: string; message: string }[];
}

/** Queue strip: the experiment's rows of GET /eval-queue (fields we read). */
export interface ExperimentQueueJob {
  id: string;
  environment_id: string;
  environment_name: string | null;
  combo_index: number;
  status: JobStatus;
  queue_position: number | null;
  wait_reason: string | null;
}

export interface ExperimentQueueResponse {
  jobs: ExperimentQueueJob[];
  total: number;
  limit: number;
}

// ── Keys ─────────────────────────────────────────────────────────────────

export const experimentsKey = (projectId: string) => ['experiments', projectId] as const;
export const experimentListKey = (projectId: string, params: ExperimentListParams) =>
  ['experiments', projectId, 'list', params] as const;
export const experimentKey = (projectId: string, experimentId: string) =>
  ['experiments', projectId, 'detail', experimentId] as const;
export const experimentQueueKey = (projectId: string, experimentId: string) =>
  ['experiments', projectId, 'queue-strip', experimentId] as const;

const base = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/experiments`;

// ── Queries ──────────────────────────────────────────────────────────────

export function experimentListQuery(params: ExperimentListParams): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.mine) qs.set('mine', 'true');
  if (params.latency) qs.set('latency_sensitive', 'true');
  for (const [k, v] of Object.entries(params.versioning ?? {}))
    if (k && v) qs.append('versioning', `${k}=${v}`);
  qs.set('include_versioning_facets', 'true');
  qs.set('limit', String(params.limit ?? 50));
  qs.set('offset', String(params.offset ?? 0));
  return qs.toString();
}

/**
 * Polling interval for a query: `refetchInterval` needs the value before the query runs
 * while the backoff depends on the query's data, so the delay is copied into state.
 */
function usePollState(): [number | false, (delay: number | false) => void] {
  return useState<number | false>(false);
}

const fingerprintOf = (rows: { id: string; status: string }[] | undefined) =>
  (rows ?? []).map((r) => `${r.id}:${r.status}`).join('|');

export function useExperiments(projectId: string | undefined, params: ExperimentListParams) {
  const [poll, setPoll] = usePollState();
  const query = useQuery({
    queryKey: experimentListKey(projectId ?? '', params),
    enabled: Boolean(projectId),
    placeholderData: (prev) => prev,
    refetchInterval: poll,
    queryFn: () => api.get<ExperimentList>(`${base(projectId ?? '')}?${experimentListQuery(params)}`),
  });
  const active = Boolean(query.data?.experiments.some((x) => LIVE_EXPERIMENT_STATUSES.includes(x.status)));
  const next = useBackoffInterval(active, {
    dataUpdatedAt: query.dataUpdatedAt,
    resetKey: fingerprintOf(query.data?.experiments),
  });
  useEffect(() => setPoll(next), [next, setPoll]);
  return query;
}

/** True while any current attempt is not finished (drives polling). */
export function hasLiveJobs(detail: ExperimentDetail | undefined): boolean {
  return Boolean(detail?.jobs.some((j) => !isTerminalJob(j.status)));
}

export function useExperiment(projectId: string | undefined, experimentId: string) {
  const [poll, setPoll] = usePollState();
  const query = useQuery({
    queryKey: experimentKey(projectId ?? '', experimentId),
    enabled: Boolean(projectId),
    refetchInterval: poll,
    queryFn: () => api.get<ExperimentDetail>(`${base(projectId ?? '')}/${encodeURIComponent(experimentId)}`),
  });
  const next = useBackoffInterval(hasLiveJobs(query.data), {
    dataUpdatedAt: query.dataUpdatedAt,
    resetKey: fingerprintOf(query.data?.jobs),
  });
  useEffect(() => setPoll(next), [next, setPoll]);
  return query;
}

/** The experiment's rows of the dispatch queue (strip above the matrix); polls while `live`. */
export function useExperimentQueue(projectId: string | undefined, experimentId: string, live: boolean) {
  const [poll, setPoll] = usePollState();
  const query = useQuery({
    queryKey: experimentQueueKey(projectId ?? '', experimentId),
    enabled: Boolean(projectId) && live,
    refetchInterval: poll,
    queryFn: () =>
      api.get<ExperimentQueueResponse>(
        `/v1/projects/${encodeURIComponent(projectId ?? '')}/eval-queue?experiment_id=${encodeURIComponent(experimentId)}&limit=1000`,
      ),
  });
  const next = useBackoffInterval(live, { dataUpdatedAt: query.dataUpdatedAt });
  useEffect(() => setPoll(next), [next, setPoll]);
  return query;
}

// ── Mutations ────────────────────────────────────────────────────────────

function applyDetail(qc: QueryClient, projectId: string, detail: ExperimentDetail) {
  qc.setQueryData(experimentKey(projectId, detail.id), detail);
  void qc.invalidateQueries({ queryKey: [...experimentsKey(projectId), 'list'] });
  void qc.invalidateQueries({ queryKey: [...experimentsKey(projectId), 'queue-strip', detail.id] });
}

/** Cancel / retry calls for one experiment. Each stores the returned detail in the cache. */
export function useExperimentActions(projectId: string | undefined, experimentId: string) {
  const qc = useQueryClient();
  const pid = projectId ?? '';
  const url = `${base(pid)}/${encodeURIComponent(experimentId)}`;
  const cancelExperiment = useMutation({
    mutationFn: (body: { include_running?: boolean; reason?: string }) =>
      api.post<CancelExperimentResult>(`${url}/cancel`, body),
    onSuccess: (r) => applyDetail(qc, pid, r.experiment),
  });
  const cancelJob = useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason?: string }) =>
      api.post<CancelJobResult>(`${url}/jobs/${encodeURIComponent(jobId)}/cancel`, reason ? { reason } : {}),
    onSuccess: (r) => applyDetail(qc, pid, r.experiment),
  });
  const retryJob = useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body?: RetryBody }) =>
      api.post<RetryJobResult>(`${url}/jobs/${encodeURIComponent(jobId)}/retry`, body ?? {}),
    onSuccess: (r) => applyDetail(qc, pid, r.experiment),
  });
  return { cancelExperiment, cancelJob, retryJob };
}

/** POST /eval-environments/{eid}/presets {kind:'saved'} (the preset API drops temporary keys). */
export function useSavePreset(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ environmentId, name, notes, config }: SavePresetInput) =>
      api.post<SavePresetResult>(
        `/v1/projects/${encodeURIComponent(projectId ?? '')}/eval-environments/${encodeURIComponent(environmentId)}/presets`,
        { kind: 'saved', name, notes: notes || null, config },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['eval-presets'] }),
  });
}
