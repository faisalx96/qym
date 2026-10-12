/**
 * Models page API (summary path only): `POST /api/dashboard/models` lists the candidate
 * runs per model and the task/dataset scope, `POST /api/dashboard/models/stats` computes the
 * K-run statistics (at most 100 groups and 2000 runs per request, so callers batch).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/http';
import type { MetricSpec } from '@/lib/metrics';
import type { DashboardFilters, TraceStats } from './dashboardTypes';

export type { DashboardFilters };

export const MAX_STAT_GROUPS = 100;
export const MAX_STAT_RUNS = 2000;

/** The run row fields the Models page reads (the server sends many more). */
export interface ModelRun {
  run_id: string;
  run_name?: string;
  task_name: string;
  model_name?: string;
  dataset_name?: string;
  timestamp: string;
  config_group_key?: string;
  metrics?: string[];
  metric_specs?: Record<string, MetricSpec & { pass_threshold?: number }>;
  metric_averages?: Record<string, number | null>;
  origin?: 'official' | 'local' | string;
  status?: string;
  total_items?: number;
  total_retries?: number;
  trace_stats?: TraceStats | null;
}

export interface ModelCandidate {
  model_key: string;
  model_name?: string;
  total_runs: number;
  rows: ModelRun[];
}

export interface ModelsResponse {
  models: ModelCandidate[];
  scope: { tasks: string[]; datasets: string[] };
  metrics: string[];
  metric_summary: Record<string, { is_boolean: boolean; is_numeric: boolean }>;
  filtered_revision: string;
  selected_revision: string;
}

export interface ModelsRequest {
  project_slug: string;
  filters: DashboardFilters;
  k: number;
  selected: Record<string, string[]>;
}

export function fetchModelCandidates(request: ModelsRequest, signal?: AbortSignal) {
  return api.post<ModelsResponse>('/api/dashboard/models', request, { signal });
}

export function useModelCandidates(request: ModelsRequest | null) {
  return useQuery({
    queryKey: ['dashboard-models', request],
    enabled: request !== null,
    queryFn: ({ signal }) => fetchModelCandidates(request!, signal),
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------- statistics

export interface StatGroup {
  key: string;
  runs: string[];
}

export interface StatRule {
  metric: string;
  threshold: number;
  is_boolean: boolean;
  direction: 'maximize' | 'minimize' | null;
}

export interface ModelStats {
  passAtK: number | null;
  passHatK: number | null;
  maxAtK: number | null;
  consistency: number | null;
  reliability: number | null;
  avgScore: number | null;
  minScore: number | null;
  stddevScore: number | null;
  totalScoreSum: number | null;
  avgLatency: number | null;
  medianLatency: number | null;
  totalItems: number;
  failedCount: number;
  K: number;
  correctDistribution: number[];
  runNames: string[];
}

/** Trace tile keys, averaged over the selected runs (the server sends them per run, not per group). */
export const TRACE_KEYS = ['avg_tokens', 'avg_llm_calls', 'avg_tool_calls', 'tool_success_rate'] as const;
export type TraceKey = (typeof TRACE_KEYS)[number];
export type TraceAverages = Partial<Record<TraceKey, number>>;

/** Mean of each trace statistic over the runs that report it. */
export function traceAverages(runs: ModelRun[]): TraceAverages {
  const out: TraceAverages = {};
  for (const key of TRACE_KEYS) {
    const values = runs
      .map((r) => r.trace_stats?.[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length) out[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return out;
}

export interface StatsResponse {
  groups: Record<string, ModelStats>;
  missing: string[];
}

/**
 * Split groups into requests within the server limits. A group is never split (its
 * statistics need every run), duplicate runs inside a group are dropped.
 */
export function batchStatGroups(
  groups: StatGroup[],
  maxGroups = MAX_STAT_GROUPS,
  maxRuns = MAX_STAT_RUNS,
): StatGroup[][] {
  const batches: StatGroup[][] = [];
  let batch: StatGroup[] | null = null;
  let runCount = 0;
  for (const raw of groups) {
    const group = { key: String(raw.key), runs: [...new Set(raw.runs)] };
    if (!batch || batch.length >= maxGroups || runCount + group.runs.length > maxRuns) {
      batch = [];
      runCount = 0;
      batches.push(batch);
    }
    batch.push(group);
    runCount += group.runs.length;
  }
  return batches;
}

export class StatsMissingError extends Error {
  constructor() {
    super('Some selected runs are no longer available. Refresh the model selection.');
    this.name = 'StatsMissingError';
  }
}

export async function fetchModelStats(
  groups: StatGroup[],
  rule: StatRule,
  signal?: AbortSignal,
): Promise<Record<string, ModelStats>> {
  if (!rule.metric || groups.length === 0) return {};
  const responses = await Promise.all(
    batchStatGroups(groups).map((batch) =>
      api.post<StatsResponse>('/api/dashboard/models/stats', { ...rule, groups: batch }, { signal }),
    ),
  );
  const merged: Record<string, ModelStats> = {};
  for (const response of responses) {
    if (response.missing?.length) throw new StatsMissingError();
    Object.assign(merged, response.groups);
  }
  return merged;
}

export function useModelStats(groups: StatGroup[], rule: StatRule | null) {
  return useQuery({
    queryKey: ['dashboard-model-stats', rule, groups],
    enabled: rule !== null && groups.length > 0,
    queryFn: ({ signal }) => fetchModelStats(groups, rule!, signal),
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------- run selection dialog

export interface RunsPageRequest {
  project_slug: string;
  filters: DashboardFilters;
  sort: string;
  limit: number;
  offset: number;
  include_config_groups: boolean;
}

export interface ConfigGroupSummary {
  key: string;
  label?: string;
  total_runs?: number;
}

/** `tasks` nests `task -> model -> runs[]`; flatten with `flattenRunsPage`. */
export interface RunsPageResponse {
  tasks: Record<string, Record<string, ModelRun[]>>;
  total_runs: number;
  config_groups?: ConfigGroupSummary[];
}

export function flattenRunsPage(tasks: RunsPageResponse['tasks']): ModelRun[] {
  const rows: ModelRun[] = [];
  for (const byModel of Object.values(tasks ?? {}))
    for (const runs of Object.values(byModel)) rows.push(...runs);
  return rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

export function useModelRunsPage(request: RunsPageRequest | null) {
  return useQuery({
    queryKey: ['dashboard-runs-page', request],
    enabled: request !== null,
    queryFn: ({ signal }) => api.post<RunsPageResponse>('/api/dashboard/runs', request, { signal }),
    placeholderData: (previous) => previous,
  });
}
