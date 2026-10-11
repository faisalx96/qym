/**
 * Payload types for POST /api/dashboard/* (brief 03 §4). Row = descriptor ∪
 * summary (`services/dashboard_summaries.py`); the summary half is partial
 * while `summary_state === 'pending'`.
 */
import type { MetricSpec } from '@/lib/metrics';

export type RunStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type RunOrigin = 'official' | 'local';

export interface DashboardFilters {
  tasks?: string[];
  models?: string[];
  datasets?: string[];
  statuses?: string[];
  versions?: string[];
  users?: string[];
  origins?: (RunOrigin | '__none__')[];
  versioning?: Record<string, string[]>;
  since?: string;
  until?: string;
  q?: string;
}

export interface Freshness {
  updating: boolean;
  pending_partitions: number;
  backfilling: boolean;
  unpublished_runs: number;
  failed_partitions: number;
  oldest_pending_at: string | null;
}

export interface FreshnessEnvelope {
  revision?: number;
  catalog_revision?: string;
  freshness: Freshness;
}

export interface RunOwner {
  id: string;
  email: string;
  display_name: string;
}

export interface RunApproval {
  decision: string;
  decision_by: { display_name?: string; email?: string } | null;
  comment: string | null;
}

export interface TraceStats {
  has_spans?: boolean;
  avg_tokens?: number | null;
  avg_llm_calls?: number | null;
  avg_tool_calls?: number | null;
  tool_success_rate?: number | null;
  has_reasoning?: boolean;
  [key: string]: unknown;
}

export interface PassSummary {
  pass_number: number;
  status: string;
  primary_metric: string | null;
  primary_score: number | null;
  error_count: number;
  task_error_count: number;
  metric_error_count: number;
  metric_error_counts: Record<string, number>;
  retry_count: number;
  analysis_cause_count: number;
}

export interface RunRow {
  run_id: string;
  file_path: string;
  run_name: string;
  external_run_id: string;
  task_name: string;
  model_name: string;
  model_key: string;
  dataset_name: string;
  dataset_version: string | null;
  dataset_aliases: string[];
  dataset_slug: string | null;
  timestamp: string;
  started_at: string | null;
  last_event_at: string;
  metrics: string[];
  metric_specs: Record<string, MetricSpec>;
  samples: number;
  report_k: number | null;
  last_completed_pass: number | null;
  pass_revision: number;
  git_branch: string | null;
  git_commit: string | null;
  owner: RunOwner | null;
  approval: RunApproval | null;
  status: RunStatus;
  status_reason: string | null;
  stop_requested: boolean;
  trace_stats: TraceStats | null;
  ingest_incomplete: boolean;
  origin: RunOrigin;
  experiment: { id: string; name: string; job_id: string } | null;
  versioning: Record<string, string>;
  versioning_details: Record<string, unknown>;
  langfuse_url?: string | null;
  product_eval?: unknown;
  // summary
  summary_state: 'published' | 'pending';
  _revision?: number;
  metric_averages: Record<string, number>;
  metric_scored_averages?: Record<string, number>;
  metric_neighbor_values?: Record<string, [number | null, number | null]>;
  total_items: number;
  progress_completed: number;
  progress_total: number | null;
  progress_pct: number | null;
  success_count: number;
  error_count: number;
  not_received_count: number;
  execution_count: number;
  execution_success_count: number;
  execution_error_count: number;
  task_error_count?: number;
  metric_error_count?: number;
  metric_error_counts?: Record<string, number>;
  total_retries: number;
  success_rate: number;
  avg_latency_ms: number | null;
  median_latency_ms: number | null;
  duration_ms: number | null;
  analysis_cause_count: number;
  pass_summaries: PassSummary[];
}

export interface Kpis {
  scope: 'project' | 'filtered';
  runs: number;
  models: number;
  items: number;
  execution_success: number | null;
  runs_with_errors: number;
}

export interface Facets {
  tasks: string[];
  models: string[];
  datasets: string[];
  statuses: string[];
  versions: string[];
  users: string[];
  origins: string[];
  versioning: Record<string, string[]>;
}

export interface SortValues {
  tasks: string[];
  models: string[];
  dataset_names: string[];
  git_commits: string[];
  owner_names: string[];
}

export interface ComboModel {
  runs: number;
  runsList: RunRow[];
  totalItems: number;
  latestTimestamp: string | null;
  metricSums: Record<string, number>;
  metricCounts: Record<string, number>;
  metricAverages: Record<string, number>;
  avgLatencyMs: number | null;
  medianLatencyMs: number | null;
  latencySum: number;
  latencyCount: number;
}

export interface Combo {
  task: string;
  dataset: string;
  totalRuns: number;
  revision: string;
  metrics: string[];
  models: Record<string, ComboModel>;
}

export interface ChartData {
  combos: Combo[];
  tasks: { task: string; datasets: Combo[] }[];
  models: string[];
  metrics: string[];
  modelIndex: Record<string, number>;
  model_frequency: Record<string, number>;
}

export type MetricType = 'score' | 'numeric' | 'boolean' | string;

export interface Overview extends FreshnessEnvelope {
  project: string;
  total_count: number;
  total_runs: number;
  aggregations: {
    totalRuns: number;
    totalTasks: number;
    totalModels: number;
    totalItems: number;
    avgSuccess: number;
    byModel: Record<string, unknown>;
    byTask: Record<string, unknown>;
    byDay: Record<string, unknown>;
  };
  all_models: string[];
  all_metrics: string[];
  metrics: string[];
  metric_types: Record<string, MetricType>;
  metric_specs: Record<string, MetricSpec>;
  has_trace_stats: boolean;
  has_active_runs?: boolean;
  facets: Facets;
  owners: Record<string, RunOwner>;
  sort_values: SortValues;
  kpis: Kpis;
  filtered_revision: string;
  chart_data: ChartData;
}

export interface RunsPage extends FreshnessEnvelope {
  tasks: Record<string, Record<string, RunRow[]>>;
  rows: RunRow[];
  pinned_rows: RunRow[];
  total_runs: number;
  total_count: number;
  has_more: boolean;
  offset: number;
  limit: number;
  project: string;
  overview?: Overview;
}

export interface KpisResponse extends FreshnessEnvelope {
  kpis: Kpis;
  project: string;
}

export interface TrendPoint {
  date: string;
  runs: number;
  metric_runs: number;
  metric_mean: number | null;
  execution_success: number | null;
}

export interface Trend {
  days: 7 | 30 | 90;
  since: string;
  until: string;
  tasks: { task: string; dataset: string; runs: number }[];
  task: string | null;
  dataset: string | null;
  metric: string | null;
  direction: 'maximize' | 'minimize' | null;
  latest_run_at: string | null;
  points: TrendPoint[];
  summary: {
    runs: number;
    metric_mean: number | null;
    previous_runs: number;
    previous_metric_mean: number | null;
    delta: number | null;
    execution_success: number | null;
  } | null;
}

export interface GroupStats {
  passAtK: number | null;
  passHatK?: number | null;
  maxAtK?: number | null;
  consistency: number | null;
  reliability: number | null;
  avgScore?: number | null;
  avgLatency?: number | null;
  medianLatency?: number | null;
  totalItems?: number;
  failedCount?: number;
  K?: number;
  [key: string]: unknown;
}

export interface ModelsStatsResponse {
  groups: Record<string, GroupStats>;
  missing: string[];
}

export interface RunPass {
  pass_number: number;
  status: string;
  metric_means: Record<string, number | null>;
  items_scored: number;
  items_total: number;
  completed_count: number;
  error_count: number;
  task_error_count: number;
  metric_error_count: number;
  metric_error_counts: Record<string, number>;
  retry_count: number;
  avg_latency_ms: number | null;
  median_latency_ms: number | null;
  p95_latency_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  trace_stats: TraceStats | null;
}

export interface RunPasses {
  run_id: string;
  samples: number;
  metrics: string[];
  passes: RunPass[];
  latency?: { avg: number | null; median: number | null; p95: number | null };
  error?: string;
}

export interface GroupMetrics {
  run_id: string;
  metric: string;
  direction: 'maximize' | 'minimize' | null;
  threshold: number;
  samples: number;
  report_k: number | null;
  group: {
    k: number;
    report_k: number | null;
    threshold: number;
    total_items: number;
    pass_at_k: number | null;
    pass_hat_k: number | null;
    avg_at_k: number | null;
    max_at_k: number | null;
    consistency: number | null;
    reliability: number | null;
  } | null;
  band?: Record<string, unknown>;
  error?: string;
}

export interface PendingCorrection {
  id: string;
  run_id?: string;
  run_name?: string;
  item_id?: string;
  item_index?: number;
  ai_root_cause?: string | null;
  human_root_cause?: string | null;
  created_at?: string;
  proposed_by?: { display_name?: string; email?: string } | null;
  [key: string]: unknown;
}

export interface CorrectionsResponse {
  corrections?: PendingCorrection[];
  items?: PendingCorrection[];
  total?: number;
  next_cursor?: string | null;
}
