/**
 * Data access of the experiment launch form (brief 06 §4, §8). Typed with the launch model's
 * payload types (`features/experiments/launch/model`), so the model layer can consume the
 * responses as they are. Query keys are shared with `evalEnvironments.ts` wherever the same
 * resource is read there (form, model slots, model options, presets, versioning details), so a
 * slot-editor save or a schema refresh invalidates the launch form as well.
 *
 * The fetchers are exported on their own (not only as hooks) because the launch provider also
 * reads them imperatively (`queryClient.ensureQueryData`) to build a fresh form context while
 * it lays a starting point under the document.
 */
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import {
  bestRunQuery,
  type BestRunBaseResponse,
  type BestRunScope,
  type CloneResponse,
  type DryRunResponse,
  type EvaluatorPanel,
  type FormResponse,
  type LaunchRequest,
  type ModelOptions,
  type ModelSlot,
  type PresetVersionResponse,
  type PromotePrefillResponse,
} from '@/features/experiments/launch/model';
import type { EvalEnvironment } from './evalCommon';
import type { Preset } from './evalEnvironments';
import { presetsKey } from './evalEnvironments';

const enc = encodeURIComponent;
const project = (projectId: string) => `/v1/projects/${enc(projectId)}`;
const env = (projectId: string, envId: string) => `${project(projectId)}/eval-environments/${enc(envId)}`;

// ── Keys ─────────────────────────────────────────────────────────────────

export const launchKeys = {
  form: (pid: string, eid: string) => ['eval-environment-form', pid, eid] as const,
  slots: (pid: string, eid: string) => ['eval-model-slots', pid, eid] as const,
  options: (pid: string, eid: string) => ['eval-model-options', pid, eid] as const,
  extraSlot: (pid: string, eid: string, name: string) => ['env-extra-slot', pid, eid, name] as const,
  versioning: (pid: string, eid: string) => ['eval-versioning-details', pid, eid] as const,
  presets: presetsKey,
  presetVersion: (pid: string, eid: string, presetId: string, version: number) =>
    ['preset-version', pid, eid, presetId, version, 'remap'] as const,
  datasets: (projectId: string) => ['launch-datasets', projectId] as const,
  datasetVersions: (slug: string, name: string) => ['dataset-versions', slug, name] as const,
  evaluatorConfig: (pid: string, signature: string) => ['evaluator-config', pid, signature] as const,
  bestRunScope: (pid: string, eid: string) => ['best-run-scope', pid, eid] as const,
  bestRuns: (pid: string, eid: string, query: string) => ['best-runs', pid, eid, query] as const,
  bestRunBase: (pid: string, eid: string, runId: string, metric: string) =>
    ['best-run-base', pid, eid, runId, metric] as const,
  latestExperiment: (pid: string) => ['experiments', pid, 'latest'] as const,
};

// ── Environment data (form, slots, options) ──────────────────────────────

export interface ModelSlotsPayload {
  environment_id?: string;
  schema_id?: string | null;
  slots: ModelSlot[];
  needs_confirmation: boolean;
  proposal?: ModelSlot | null;
}

export const fetchForm = (pid: string, eid: string) => api.get<FormResponse>(`${env(pid, eid)}/form`);
export const fetchSlots = (pid: string, eid: string) =>
  api.get<ModelSlotsPayload>(`${env(pid, eid)}/model-slots`);
export const fetchOptions = (pid: string, eid: string) =>
  api.get<ModelOptions>(`${env(pid, eid)}/model-options`);
/** The slot the server would derive for `endpoint:<name>` (null: this environment cannot add it). */
export async function fetchProposal(pid: string, eid: string, name: string): Promise<ModelSlot | null> {
  const res = await api.get<ModelSlotsPayload>(`${env(pid, eid)}/model-slots?propose_endpoint=${enc(name)}`);
  return res.proposal ?? null;
}

/** Re-reads the environment's schema from the service (POST …/schema/refresh). */
export interface SchemaRefreshResult {
  changed: boolean;
  schema_hash?: string;
  needs_confirmation?: boolean;
  added?: string[];
  removed?: string[];
  evaluator?: { changed?: boolean; added?: string[]; removed?: string[] };
}
export const refreshSchema = (pid: string, eid: string) =>
  api.post<SchemaRefreshResult>(`${env(pid, eid)}/schema/refresh`);

/** Drops the cached form, slots, options and presets of one environment so they reload. */
export function invalidateEnvData(qc: QueryClient, pid: string, eid: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: launchKeys.form(pid, eid) }),
    qc.invalidateQueries({ queryKey: launchKeys.slots(pid, eid) }),
    qc.invalidateQueries({ queryKey: launchKeys.options(pid, eid) }),
    qc.invalidateQueries({ queryKey: ['env-extra-slot', pid, eid] }),
    qc.invalidateQueries({ queryKey: launchKeys.presets(pid, eid) }),
    qc.invalidateQueries({ queryKey: ['eval-environments', pid] }),
  ]);
}

/** Same request as `useEvalEnvironments(projectId, { active: true })` (shares its cache entry). */
export async function fetchActiveEnvironments(projectId: string): Promise<EvalEnvironment[]> {
  const r = await api.get<{ environments: EvalEnvironment[] }>(
    `${project(projectId)}/eval-environments?active=true`,
  );
  return r.environments;
}

// ── Versioning details (on demand) ───────────────────────────────────────

export interface VersioningDetailsPayload {
  environment_id: string;
  status: 'ok' | 'unsupported' | 'error';
  versioning_details: Record<string, unknown>;
  error: string | null;
  fetched_at: string | null;
}
/** Live service call: enabled only for a ticked environment (its box's versions line), read again on its Refresh. */
export function useEnvVersioning(projectId: string | undefined, envId: string | undefined, enabled = false) {
  return useQuery({
    queryKey: launchKeys.versioning(projectId ?? '', envId ?? ''),
    enabled: Boolean(projectId && envId && enabled),
    staleTime: Infinity,
    queryFn: () => api.get<VersioningDetailsPayload>(`${env(projectId!, envId!)}/versioning-details`),
  });
}

// ── Presets ──────────────────────────────────────────────────────────────

export interface PresetListPayload {
  environment_id: string;
  can_publish_official: boolean;
  presets: Preset[];
}
export const fetchPresets = (pid: string, eid: string) =>
  api.get<PresetListPayload>(`${env(pid, eid)}/presets`);

/** One preset version re-mapped onto the environment's current schema. */
export const fetchPresetVersion = (pid: string, eid: string, presetId: string, version: number) =>
  api.get<PresetVersionResponse>(
    `${env(pid, eid)}/presets/${enc(presetId)}/versions/${version}?remap=current`,
  );

/** GET …/promote-prefill: a saved preset / run / job as a draft default preset (managers; never publishes). */
export const fetchPromotePrefill = (pid: string, eid: string, kind: 'saved' | 'run' | 'job', id: string) =>
  api.get<PromotePrefillResponse>(`${env(pid, eid)}/promote-prefill?kind=${enc(kind)}&id=${enc(id)}`);

/** Presets (official + saved) of one environment. */
export function useEnvPresets(projectId: string | undefined, envId: string | undefined) {
  return useQuery({
    queryKey: launchKeys.presets(projectId ?? '', envId ?? ''),
    enabled: Boolean(projectId && envId),
    queryFn: () => fetchPresets(projectId!, envId!),
  });
}

// ── Datasets ─────────────────────────────────────────────────────────────

export interface DatasetVersionRow {
  version: string;
  status?: string;
  aliases?: string[];
}

/**
 * A dataset the launch picker offers. The list is every dataset of the project, not the
 * access-filtered catalog (owner decision D3): `private_test_set` and `access_mode` only
 * drive the badge and the help line.
 */
export interface LaunchDataset {
  id: string;
  name: string;
  slug: string;
  private_test_set: boolean;
  access_mode: 'project' | 'restricted' | string;
}

export async function fetchLaunchDatasets(projectId: string): Promise<LaunchDataset[]> {
  const res = await api.get<{ datasets?: LaunchDataset[] }>(`${project(projectId)}/experiments/launch-datasets`);
  return res.datasets ?? [];
}

export function useLaunchDatasets(projectId: string | undefined) {
  return useQuery({
    queryKey: launchKeys.datasets(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => fetchLaunchDatasets(projectId!),
  });
}

export interface DatasetVersions {
  versions: DatasetVersionRow[];
  aliases: string[];
}
/** Versions and aliases of one project dataset (fetched when it is picked). */
export function useDatasetVersions(slug: string | undefined, name: string | undefined) {
  return useQuery({
    queryKey: launchKeys.datasetVersions(slug ?? '', name ?? ''),
    enabled: Boolean(slug && name),
    queryFn: async (): Promise<DatasetVersions> => {
      const res = await api.get<{ versions?: DatasetVersionRow[] }>(
        `/v1/datasets/${enc(name!)}/versions?project_slug=${enc(slug!)}`,
      );
      const versions = res.versions ?? [];
      const aliases: string[] = [];
      for (const v of versions) for (const a of v.aliases ?? []) if (!aliases.includes(a)) aliases.push(a);
      return { versions, aliases };
    },
  });
}

// ── Evaluator config panel ───────────────────────────────────────────────

export interface EvaluatorConfigTarget {
  id: string;
  schemaHash?: string | null;
  evaluatorSchemaHash?: string | null;
}
export const evaluatorConfigSignature = (envs: readonly EvaluatorConfigTarget[]) =>
  envs.map((e) => `${e.id}:${e.schemaHash ?? ''}:${e.evaluatorSchemaHash ?? ''}`).join('|');

export function fetchEvaluatorConfig(projectId: string, envs: readonly EvaluatorConfigTarget[]) {
  const qs = envs.map((e) => `environment_id=${enc(e.id)}`).join('&');
  return api.get<EvaluatorPanel>(`${project(projectId)}/experiments/evaluator-config?${qs}`);
}

/** GET …/experiments/evaluator-config for the selected environments (the "Evaluation inputs" panel). */
export function useEvaluatorConfig(projectId: string | undefined, envs: readonly EvaluatorConfigTarget[]) {
  return useQuery({
    queryKey: launchKeys.evaluatorConfig(projectId ?? '', evaluatorConfigSignature(envs)),
    enabled: Boolean(projectId && envs.length),
    placeholderData: keepPreviousData,
    queryFn: () => fetchEvaluatorConfig(projectId!, envs),
  });
}

// ── Best runs (the picker UI is built on these) ──────────────────────────

export interface BestRunScopeDataset {
  id: string;
  name: string;
  run_count: number;
  versions: Array<{ id: string; version: string; run_count: number }>;
}
export interface BestRunScopePayload {
  datasets: BestRunScopeDataset[];
  versioning: Record<string, Array<{ value: string; run_count: number }>>;
  total_runs: number;
}
export interface BestRunRow {
  rank: number;
  run_id: string;
  external_run_id?: string | null;
  task?: string | null;
  model?: string | null;
  status?: string;
  job_id?: string | null;
  experiment_id?: string | null;
  combo_index?: number | null;
  metric?: string;
  direction?: string | null;
  score: number | null;
  pass_at_k?: Record<string, number> | null;
  pass_at_k_value?: number | null;
  item_count?: number;
  error_item_count?: number;
  error_ratio?: number;
  completed_at?: string | null;
  age_seconds?: number | null;
  dataset?: { id: string; name: string } | null;
  dataset_version?: { id: string; version: string } | null;
  remote_versioning?: Record<string, unknown> | null;
  params?: {
    sweep?: Record<string, unknown>;
    slot_bindings?: Record<string, unknown>;
    has_config?: boolean;
    [key: string]: unknown;
  };
}
export interface BestRunsPayload {
  environment_id: string;
  dataset: { id: string; name: string } | null;
  dataset_version: { id: string; version: string } | null;
  scope: {
    dataset: unknown;
    dataset_version: unknown;
    versioning: Record<string, string[]>;
    global: boolean;
  };
  metric: string | null;
  metric_source?: string | null;
  direction?: string | null;
  k?: number | null;
  exclude_errored: boolean;
  metrics: Array<{ name: string; run_count: number }>;
  eligible_count?: number;
  excluded_errored_count?: number;
  runs: BestRunRow[];
  reason: string | null;
  latest_version_with_runs?: { id: string; version: string; name?: string; run_count: number } | null;
  latest_remote_versioning?: {
    versioning: Record<string, unknown>;
    job_id?: string;
    run_id?: string | null;
  } | null;
}

/** The datasets, versions and versioning values the scope prompt offers. */
export function useBestRunScope(projectId: string | undefined, envId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: launchKeys.bestRunScope(projectId ?? '', envId ?? ''),
    enabled: Boolean(projectId && envId && enabled),
    queryFn: () => api.get<BestRunScopePayload>(`${env(projectId!, envId!)}/best-runs/scope`),
  });
}

/** Top runs of a scope. `scope === null` keeps the query idle (nothing is fetched before "Find"). */
export function useBestRuns(
  projectId: string | undefined,
  envId: string | undefined,
  scope: BestRunScope | null,
) {
  const query = scope ? bestRunQuery(scope) : '';
  return useQuery({
    queryKey: launchKeys.bestRuns(projectId ?? '', envId ?? '', query),
    enabled: Boolean(projectId && envId && scope),
    queryFn: () => api.get<BestRunsPayload>(`${env(projectId!, envId!)}/best-runs?${query}`),
  });
}

export const fetchBestRunBase = (pid: string, eid: string, runId: string, metric?: string) =>
  api.get<BestRunBaseResponse>(
    `${env(pid, eid)}/best-runs/${enc(runId)}/base${metric ? `?metric=${enc(metric)}` : ''}`,
  );

/** A best run as a launch-ready base (re-mapped, with the temporary models it asks keys for). */
export function useBestRunBase(
  projectId: string | undefined,
  envId: string | undefined,
  runId: string | undefined,
  metric?: string,
) {
  return useQuery({
    queryKey: launchKeys.bestRunBase(projectId ?? '', envId ?? '', runId ?? '', metric ?? ''),
    enabled: Boolean(projectId && envId && runId),
    queryFn: () => fetchBestRunBase(projectId!, envId!, runId!, metric),
  });
}

// ── Experiments: clone, dry run / launch, latest ─────────────────────────

/** POST …/experiments/{xid}/clone[?job_id=]: the prefill of "Copy an experiment" / "Rerun with this config". */
export const cloneExperiment = (pid: string, experimentId: string, jobId?: string | null) =>
  api.post<CloneResponse>(
    `${project(pid)}/experiments/${enc(experimentId)}/clone${jobId ? `?job_id=${enc(jobId)}` : ''}`,
  );

/** POST …/experiments (dry run or real). Rejects with ApiError; `error.body` feeds `parseLaunchFailure`. */
export function postExperiment<T = DryRunResponse>(pid: string, body: LaunchRequest, signal?: AbortSignal) {
  return api.post<T>(`${project(pid)}/experiments`, body, { signal });
}

export interface LatestExperiment {
  id: string;
  name: string;
  environment_ids: string[];
}
/** The most recent experiment of the project (the "Copy of experiment" card). */
export function useLatestExperiment(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: launchKeys.latestExperiment(projectId ?? ''),
    enabled: Boolean(projectId && enabled),
    queryFn: async () => {
      const res = await api.get<{ experiments: LatestExperiment[] }>(
        `${project(projectId!)}/experiments?limit=1`,
      );
      return res.experiments[0] ?? null;
    },
  });
}
