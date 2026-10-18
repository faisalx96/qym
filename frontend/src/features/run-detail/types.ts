/** Run detail API shapes (brief 04 §4, verified against the live API in ANALYSIS.md). */
import type { MetricMeta, MetricSpec } from '@/lib/metrics';

export type RunStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | string;

export interface RunOwner {
  id?: string;
  email?: string;
  display_name?: string;
}

export interface RunProject {
  id?: string;
  slug?: string;
  name?: string;
  archived?: boolean;
}

export interface IngestIncomplete {
  expected_items?: number;
  received_items?: number;
  rejected_events?: number;
  rejected?: Array<{ type?: string; item_id?: string; sequence?: number; event_id?: string; error?: string }>;
  reason?: string;
}

export interface TraceStatsSummary {
  has_spans?: boolean;
  has_reasoning?: boolean;
  avg_tokens?: number | null;
  avg_llm_calls?: number | null;
  [key: string]: unknown;
}

export interface RunExperiment {
  id: string;
  name?: string;
  job_id?: string | null;
  panel?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Run {
  run_id: string;
  file_path?: string;
  task_name?: string;
  dataset_name?: string;
  dataset_version?: string | number | null;
  dataset_aliases?: string[];
  dataset_slug?: string | null;
  model_name?: string;
  run_name?: string;
  external_run_id?: string | null;
  metric_names?: string[];
  metric_specs?: Record<string, MetricSpec>;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown> & {
    ingest_incomplete?: IngestIncomplete;
    pass_revision?: number | string;
    last_completed_pass?: number;
    analysis_aggregation?: unknown;
    has_repeat_pass_context?: boolean;
  };
  status: RunStatus;
  status_reason?: string | null;
  status_reason_label?: string | null;
  stop_requested?: boolean;
  owner?: RunOwner | null;
  project?: RunProject | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  duration_ms?: number | null;
  git_branch?: string | null;
  git_commit?: string | null;
  langfuse_host?: string | null;
  langfuse_project_id?: string | null;
  trace_stats?: TraceStatsSummary | null;
  samples?: number;
  last_completed_pass?: number;
  experiment?: RunExperiment | null;
  versioning_details?: Record<string, unknown>;
  live_revision?: string;
  items_restricted?: boolean;
  origin?: string;
  error_count?: number;
  execution_count?: number;
  execution_error_count?: number;
  execution_success_count?: number;
}

export interface RowTraceStats {
  tokens?: number;
  cost?: number;
  llm_calls?: number;
  tool_calls?: number;
  tool_errors?: number;
  malformed_tool_calls?: number;
  noisy_reasoning?: number;
  provider_errors?: number;
  has_reasoning?: boolean;
  reasoning_tokens?: number;
  [key: string]: unknown;
}

export interface RootCauseIssue {
  issue_id?: string;
  category: string;
  subcategory: string;
  finding: string;
  category_reason: string;
  solution?: string;
  solution_note?: string;
  review_status?: string;
  source?: string;
  reviewed_at?: string;
  confidence?: number;
}

export interface MetricAnalysis {
  root_cause_issues?: unknown[];
  root_cause?: unknown;
  root_causes?: unknown;
  root_cause_categories?: unknown;
  root_cause_detail?: string;
  root_cause_note?: string;
  root_cause_reason?: string;
  confidence?: number | string;
  root_cause_confidence?: number | string;
  source?: string;
  review_status?: string;
  error?: string;
  warning?: string;
  solution?: string;
  solution_note?: string;
  [key: string]: unknown;
}

export interface PassAttempt {
  pass_number?: number | null;
  attempt_number?: number;
  status?: string;
  latency_ms?: number | null;
  trace_id?: string;
  trace_url?: string;
  task_started_at_ms?: number | null;
  error?: string;
  output?: unknown;
  output_digest?: string;
  __has_output?: boolean;
  __execution_error?: string;
  retry_count?: number;
  trace_stats?: RowTraceStats | null;
}

export interface Row {
  index: number;
  item_id: string;
  compare_item_id?: string;
  status: 'completed' | 'error' | 'running' | 'pending' | 'not_received' | string;
  error?: string;
  execution_error_count?: number;
  output_received?: boolean;
  time?: string;
  latency_ms?: number;
  retry_count?: number;
  trace_id?: string;
  trace_url?: string;
  task_started_at_ms?: number | null;
  metric_values: unknown[];
  metric_meta?: Record<string, MetricMeta>;
  item_metadata?: Record<string, unknown> & {
    metric_analyses?: Record<string, MetricAnalysis>;
    analysis_error?: string;
    analysis_warning?: string;
    trace_stats?: RowTraceStats;
  };
  review_correction_id?: string | null;
  review_correction_status?: string;
  review_corrections?: Record<string, { id?: string | null; status?: string }>;
  review_issue_statuses?: Record<string, Array<{ issue_id?: string; status?: string }>>;
  trace_stats?: RowTraceStats | null;
  // compact form
  input_preview?: string;
  output_digest?: string;
  __has_output?: boolean;
  __execution_error?: string;
  __details_loaded?: boolean;
  // full form
  input?: unknown;
  input_full?: unknown;
  expected?: unknown;
  expected_full?: unknown;
  output?: unknown;
  output_full?: unknown;
  // repeat runs
  pass_scores?: Record<string, unknown[]>;
  pass_metric_meta?: Record<string, MetricMeta[]>;
  pass_metric_analyses?: Record<string, Array<MetricAnalysis | null>>;
  pass_review_issue_statuses?: Record<string, Array<Array<{ issue_id?: string; status?: string }>>>;
  pass_attempts?: PassAttempt[];
  // client-only
  __pass_scope?: boolean;
  _pass_has_attempt?: boolean;
}

export interface SnapshotStats {
  total?: number;
  completed?: number;
  in_progress?: number;
  pending?: number;
  failed?: number;
  not_received?: number;
  execution_count?: number;
  execution_success_count?: number;
  success_rate?: number;
}

/** Row field groups of `?view=compact&fields=` (packages/platform api/runs.py ROW_FIELD_GROUPS). */
export type RowGroup = 'scores' | 'reasons' | 'categories' | 'traces' | 'text' | 'review';

export interface Snapshot {
  rows: Row[];
  /** The groups the rows carry; absent means every group (a payload loaded without `fields`). */
  row_fields?: RowGroup[];
  /** `?view=summary` only: how many items the run has (the rows themselves come later). */
  rows_total?: number;
  stats?: SnapshotStats;
  metric_names?: string[];
  metric_specs?: Record<string, MetricSpec>;
  detail_mode?: 'lazy' | 'full' | string;
  detail_page_size?: number;
  metric_meta_keys?: Record<string, string[]>;
  pass_metric_meta_keys?: Record<string, string[]>;
  pass_metric_meta_keys_by_pass?: Record<string, string[]>;
}

export interface RunPayload {
  run: Run;
  snapshot: Snapshot;
  /** `?view=summary` only: the runs around this one in the default list order, and the Reviews badge count. */
  neighbors?: NeighborsPayload | null;
  review_event_count?: number;
}

export interface LiveStatus {
  run_id: string;
  status: RunStatus;
  status_reason?: string | null;
  live: boolean;
  stop_requested?: boolean;
  started_at?: string | null;
  ended_at?: string | null;
  last_event_at?: string | null;
  revision: string;
  server_time?: string;
}

export interface PassSummary {
  pass_number: number;
  status?: string;
  metric_means?: Record<string, number | null>;
  items_total?: number;
  items_started?: number;
  completed_count?: number;
  error_count?: number;
  task_error_count?: number;
  metric_error_count?: number;
  running_count?: number;
  retry_count?: number;
  avg_latency_ms?: number | null;
  median_latency_ms?: number | null;
  p95_latency_ms?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  trace_stats?: TraceStatsSummary | null;
  queued?: boolean;
}

export interface PassesPayload {
  run_id: string;
  samples: number;
  metrics?: string[];
  passes: PassSummary[];
  error?: string;
}

export interface GroupMetricsBand {
  pass_at_k?: number;
  pass_hat_k?: number;
  cumulative_avg?: number;
  n_items?: number;
  uncertainty?: Record<string, { low: number; high: number }>;
}

export interface GroupMetricsPayload {
  run_id: string;
  metric: string;
  direction?: string | null;
  threshold: number;
  samples: number;
  report_k?: number | null;
  group?: {
    k?: number;
    total_items?: number;
    pass_at_k?: number;
    pass_hat_k?: number;
    avg_at_k?: number;
    max_at_k?: number;
    consistency?: number;
    reliability?: number;
  };
  band?: Record<string, GroupMetricsBand>;
  distribution?: number[];
  uncertainty?: Record<string, unknown>;
  error?: string;
}

export interface ItemDetailsPayload {
  rows: Row[];
  missing_item_ids: string[];
}

export interface ItemSearchCondition {
  id: string;
  field: 'all' | 'output';
  operator: 'contains';
  value: string;
}

export interface ItemSearchPayload {
  matches?: Record<string, string[]>;
  matches_by_pass?: Record<string, Record<string, string[]>>;
}

export interface ItemReasonsPayload {
  metric: string;
  pass_number?: number | null;
  reasons: Record<
    string,
    { reason?: string; error?: string; status?: string; explanation?: string; label?: string }
  >;
}

export interface Span {
  trace_id?: string;
  span_id: string;
  parent_span_id?: string | null;
  name: string;
  kind?: string;
  start_time_ns?: number | null;
  end_time_ns?: number | null;
  duration_ms?: number | null;
  status?: string;
  attributes?: Record<string, unknown>;
  events?: Array<{ name?: string; attributes?: Record<string, unknown>; timestamp?: unknown }>;
  links?: unknown[];
}

export interface TraceSummary {
  span_count?: number;
  root_count?: number;
  error_count?: number;
  duration_ms?: number | null;
  started_at_ns?: number | null;
  ended_at_ns?: number | null;
  has_orphans?: boolean;
  orphan_count?: number;
}

export interface TraceAttempt {
  pass_number?: number;
  attempt_number: number;
  status?: string;
  latency_ms?: number | null;
  task_started_at_ms?: number | null;
  trace_id?: string;
  trace_url?: string;
  error?: string | null;
  is_last_attempt?: boolean;
  summary?: TraceSummary;
  spans?: Span[];
}

export interface TracePayload {
  item: {
    run_id?: string;
    item_id: string;
    trace_id?: string;
    trace_url?: string;
    retry_count?: number;
    latency_ms?: number | null;
  };
  summary?: TraceSummary;
  spans?: Span[];
  attempts?: TraceAttempt[];
}

export interface StepLatencyGroup {
  phase: 'task' | 'eval' | string;
  step_type?: string;
  kind?: string;
  name?: string;
  model?: string | null;
  agent?: string | null;
  n: number;
  error_count?: number;
  tokens_total?: number;
  mean_ms?: number;
  median_ms?: number;
  std_ms?: number;
  p5_ms?: number;
  p25_ms?: number;
  p75_ms?: number;
  p95_ms?: number;
  min_ms?: number;
  max_ms?: number;
  cv?: number;
}

export interface StepLatencyPayload {
  run_ids: string[];
  rollup: string;
  pass_number?: number | null;
  passes?: number[];
  trace_count?: number;
  groups: StepLatencyGroup[];
  phases?: Array<StepLatencyGroup & { phase: string }>;
  traces?: {
    n?: number;
    error_count?: number;
    mean_ms?: number;
    median_ms?: number;
    p5_ms?: number;
    p25_ms?: number;
    p75_ms?: number;
    p95_ms?: number;
    min_ms?: number;
    max_ms?: number;
  } | null;
  agents?: Array<StepLatencyGroup & { name?: string }> | string[];
}

export interface ReviewHistoryEvent {
  action: 'submit' | 'approve' | 'reject' | 'unapprove' | 'unreject' | string;
  from_status?: string;
  to_status?: string;
  actor?: RunOwner | null;
  on_behalf_of?: RunOwner | null;
  comment?: string | null;
  at?: string;
  recorded?: boolean;
}

export interface ReviewHistoryPayload {
  run_id: string;
  status: RunStatus;
  events: ReviewHistoryEvent[];
}

export interface NeighborRun {
  run_id: string;
  run_name?: string;
  model?: string;
  started_at?: string;
  primary?: { metric?: string; value?: number | null; spec?: MetricSpec } | null;
}

export interface NeighborsPayload {
  run_id?: string;
  context?: 'list' | 'default' | null;
  position?: number;
  total?: number;
  previous?: NeighborRun | null;
  next?: NeighborRun | null;
  collation_needed?: boolean;
  sort?: string;
  sort_values?: string[];
}

export interface CategoryCatalog {
  id?: string;
  version?: number;
  categories: string[];
  category_entries?: Array<{ id: string; label: string; status?: string }>;
  category_details_map?: Record<string, unknown>;
  approved_category_details?: Record<string, string[]>;
  category_taxonomy?: Record<string, { description?: string; when_to_use?: string }>;
  subcategory_taxonomy?: Record<string, unknown>;
  max_root_cause_categories?: number;
  can_manage?: boolean;
}

export interface RowMutationResult {
  ok: boolean;
  row: Row;
}
