/** Additive Estishraf Platform page protocol. Missing discriminators continue to mean chat. */
export { downloadPerformanceFile } from './performance';
import { useEffect, useRef } from 'react';
import { hashKey, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import {
  PERFORMANCE_POLL_ACTIVE_MS,
  PERFORMANCE_POLL_IDLE_MS,
  isPerformanceRunActive,
  performanceApiPath,
  performanceKeys,
  performanceRead,
  usePerformanceMutation,
  useTokenWrite,
  type PerformanceActiveRun,
  type PerformanceBreakReason,
  type PerformanceHome,
  type PerformanceLevelResult,
  type PerformancePlanStage,
  type PerformanceReceived,
  type PerformanceRunRead,
  type PerformanceRunRow,
  type PerformanceRunsFilters,
  type PerformanceSetup,
  type PerformanceSetupTarget,
  type PerformanceStageRole,
  type PerformanceTailOptions,
  type PerformanceTarget,
  type PerformanceTargetSummary,
  type PerformanceTargetsRead,
  type PerformanceTokenHint,
  type PerformanceVerdict,
  type SaveTargetTokenRequest,
} from './performance';

export type PerformanceTargetKind = 'chat' | 'estishraf_platform';
export type PlatformTestType = 'smoke' | 'breakpoint';
export type PlatformCoverage = 'complete' | 'incomplete';
export type PlatformErrorClass =
  'auth' | 'chart_unavailable' | 'callback_error' | 'timeout' | 'server_error' | 'client_error';
export type PlatformErrors = Record<PlatformErrorClass, number>;
export type PlatformJson =
  string | number | boolean | null | PlatformJson[] | { [key: string]: PlatformJson };
export type PlatformId = string | number | { [key: string]: PlatformJson };
export type PlatformDiscoveryReason =
  'time_budget' | 'list_incomplete' | 'details_incomplete' | 'charts_incomplete' | 'final_sign_in_unchecked';
export type PlatformRouteName =
  | 'session'
  | 'token_refresh'
  | 'health_check'
  | 'my_topics'
  | 'dashboards'
  | 'dashboard'
  | 'dashboard_logo'
  | 'latest_insights'
  | 'dashboard_background'
  | 'insight_last_update'
  | 'siblings'
  | 'chart_wrapper'
  | 'chart_layout'
  | 'chart_dependencies'
  | 'chart_callback';
export interface PlatformTargetSettings {
  routes: Record<PlatformRouteName, string>;
  client_id: string;
  request_timeout_seconds: number | null;
}
export interface PlatformTokenHint extends Omit<PerformanceTokenHint, 'name'> {
  name: 'session_cookie';
}
export interface PlatformTarget extends Omit<
  PerformanceTarget,
  'chat_path' | 'token_refresh_path' | 'settings' | 'tokens' | 'last_run'
> {
  kind: 'estishraf_platform';
  settings: PlatformTargetSettings;
  tokens: PlatformTokenHint[];
  last_run: PlatformRunRow | null;
}
export interface SavePlatformTargetRequest {
  kind: 'estishraf_platform';
  name: string;
  is_production: boolean;
  base_url: string;
  max_users?: number | null;
  max_duration_s?: number | null;
  settings?: Partial<Omit<PlatformTargetSettings, 'routes'>> & {
    routes?: Partial<PlatformTargetSettings['routes']>;
  };
}
interface PlatformCommonPlan {
  limit_ms: number;
  max_error_rate_pct: number;
  filter_reference_ms: number;
  pause_seconds: number;
  filters_per_dashboard: 'all' | number;
  max_dashboards: number | null;
  timeout_seconds: number | null;
  handoff_wait_seconds: number;
  discovery_budget_seconds: number;
}
export interface PlatformBreakpointPlan extends PlatformCommonPlan {
  baseline_users: number;
  max_users: number;
  step_users: number;
  hold_seconds: number;
  ramp_seconds: number;
  abort_on_break: boolean;
  pick: 'random' | 'roundrobin';
}
export interface PlatformSmokePlan extends PlatformCommonPlan {
  users: 1;
  smoke_max_duration_seconds: number | null;
  pick: 'roundrobin';
}
export type PlatformPlanInput = PlatformBreakpointPlan | PlatformSmokePlan;
export type PlatformFrozenPlan = PlatformPlanInput & { timeout_seconds: number };
export type StartPlatformRunRequest = {
  target_id: string;
  target_kind: 'estishraf_platform';
  note?: string;
  confirm_target?: string | null;
} & (
  | { test_type: 'breakpoint'; plan: Partial<PlatformBreakpointPlan> }
  | { test_type: 'smoke'; plan: Partial<PlatformSmokePlan> }
);
export interface StartPlatformRunResponse {
  id: string;
  number: number;
  status: 'queued';
  requested_at: string;
  plan: PlatformFrozenPlan;
}
export interface PlatformResolvedPlan {
  users: number | null;
  iterations: number | null;
  smoke_max_duration_seconds: number | null;
  levels: number[];
  stages: PerformancePlanStage[];
  total_seconds: number;
  dashboard_ids: (string | number)[];
  theme: 'blue' | 'black';
  chart_batch: 6;
  baseline_seconds: 60;
  abort_grace_seconds: 30;
}
export interface PlatformRunConfig {
  schema: 1;
  test_type: PlatformTestType;
  target: Pick<PlatformTarget, 'id' | 'kind' | 'name' | 'is_production' | 'base_url' | 'settings'> & {
    max_users: number;
    max_duration_s: number;
  };
  tokens: Pick<PlatformTokenHint, 'name' | 'hint' | 'version'>[];
  plan: PlatformFrozenPlan;
  note: string;
}
export interface PlatformDiscoveryCounts {
  dashboards_visible: number | null;
  dashboards_discovered: number;
  dashboards_selected: number;
  dashboards_runnable: number;
  charts_found: number;
  charts_usable: number;
  charts_unusable: number;
  filters_found: number;
  skipped_by_budget: number;
}
export interface PlatformCoverageCounts {
  dashboards_selected: number;
  dashboards_runnable: number;
  dashboards_exercised: number;
  dashboards_unexercised: number;
  dashboards_unusable: number;
  charts_found: number;
  charts_usable: number;
  charts_unusable: number;
  discovery_partial: boolean;
  discovery_reasons: PlatformDiscoveryReason[];
  selection_limited: boolean;
}
export interface PlatformDiscoveryRow {
  id: string | number;
  title: string;
  detail_loaded: boolean;
  runnable: boolean;
  charts_found: number;
  charts_usable: number;
  filters_found: number;
  charts_unusable: {
    id: PlatformId;
    reason_class:
      | 'auth'
      | 'timeout'
      | 'server_error'
      | 'client_error'
      | 'wrapper_invalid'
      | 'layout_invalid'
      | 'dependencies_invalid'
      | 'clientside_only'
      | 'no_server_callback'
      | 'invalid_callback'
      | 'budget';
    http_status: number | null;
  }[];
}
/** The polling projection deliberately has no dashboard array. */
export interface PlatformDiscovery {
  schema: 1;
  target_kind: 'estishraf_platform';
  started_at: string;
  ended_at: string;
  duration_s: number;
  active_duration_s: number;
  partial: boolean;
  partial_reasons: PlatformDiscoveryReason[];
  selection_limited: boolean;
  counts: PlatformDiscoveryCounts;
  titles_truncated: number;
  resolved_plan: PlatformResolvedPlan | null;
}
export interface PlatformDiscoveryResult extends PlatformDiscovery {
  dashboards: PlatformDiscoveryRow[];
}

export interface PlatformProgressLevel {
  level: number;
  state: 'running' | 'done';
  hold_elapsed_s: number;
  hold_elapsed_pct: number;
  dashboard_opens: number;
  filter_changes: number;
  charts_drawn: number;
  charts_failed: number;
  errors_by_class: PlatformErrors;
  open_p50_ms: number | null;
  open_p95_ms: number | null;
  filter_p95_ms: number | null;
  requests: null;
  error_rate_pct: null;
  per_minute: number;
  result: null;
}
export interface PlatformProgress {
  target_kind: 'estishraf_platform';
  phase: 'preflight' | PerformanceStageRole | 'stopping' | 'finishing';
  step: 'certificate_check' | 'sign_in' | 'discovery' | 'plan_check' | 'starting_k6' | null;
  message: string;
  error_code: string | null;
  elapsed_s: number;
  preflight_elapsed_s: number;
  planned_s: number | null;
  stage: (PerformancePlanStage & { index: number; of: number }) | null;
  level: number | null;
  users: number | null;
  users_sample_age_s: number | null;
  users_max: number;
  discovery_counts: PlatformDiscoveryCounts | null;
  discovery_ready: boolean;
  dashboard_opens: number;
  filter_changes: number;
  charts_drawn: number;
  charts_failed: number;
  errors_by_class: PlatformErrors;
  requests: null;
  error_rate_pct: null;
  open_p50_ms: number | null;
  open_p95_ms: number | null;
  filter_p95_ms: number | null;
  levels: PlatformProgressLevel[];
  records: { received: number; dropped: number; malformed: number; uploaded: number };
  measurement: { basis: 'completed_records'; complete: boolean; percentiles_complete: boolean };
  auth: {
    state: 'checking' | 'ok' | 'retrying' | 'rejected' | 'recovered';
    token_versions: { session_cookie: number };
    session_expires_at: string | null;
    rejected_at: string | null;
    recovered_at: string | null;
    wait_deadline_at: string | null;
    incidents: number;
    refresh_ok: number;
    refresh_failed: number;
  };
  waiting_for_token: 'session_cookie' | null;
  dropped: { log_lines: number };
  coverage: PlatformCoverage;
  coverage_counts: PlatformCoverageCounts;
}
export interface PlatformHeadline {
  safe_load_users: number | null;
  recommended_max_users: number | null;
  breaking_level_users: number | null;
  breaking_reason: PerformanceBreakReason | null;
  p95_at_safe_load_ms: number | null;
  p95_at_break_ms: number | null;
  error_rate_pct: number | null;
  open_p95_ms: number | null;
  filter_p95_ms: number | null;
  opens_measured: number;
  opens_total: number;
  filters_total: number;
  charts_drawn: number;
  charts_failed: number | null;
  duration_s: number;
  max_users: number;
  highest_tested_users: number;
}
export interface PlatformSummaryLevel {
  level: number;
  role: 'hold' | 'steady';
  start_s: number;
  end_s: number;
  actual_duration_s: number;
  hold_elapsed_pct: number;
  per_minute: number;
  has_data: boolean;
  passed: boolean;
  latency_breach: boolean;
  error_breach: boolean;
  auth_contaminated: boolean;
  result: PerformanceLevelResult;
  requests: number;
  request_outcomes: number;
  failed_request_outcomes: number;
  dashboards_opened: number;
  filters_applied: number;
  charts_drawn: number;
  chart_unavailable_errors: number;
  charts_failed: number | null;
  errors_by_class: PlatformErrors;
  open_p50_ms: number | null;
  open_p95_ms: number | null;
  open_p99_ms: number | null;
  open_max_ms: number | null;
  filter_p50_ms: number | null;
  filter_p95_ms: number | null;
  filter_max_ms: number | null;
  error_rate_pct: number | null;
  auth_error_rate_pct: number | null;
  auth_waits: number;
  auth_wait_recovered: number;
}
export interface PlatformDashboardRow {
  dashboard_id: PlatformId;
  title: string;
  opens: number;
  filters: number;
  open_p50_ms: number | null;
  open_p95_ms: number | null;
  filter_p95_ms: number | null;
  charts_drawn: number;
  charts_failed: number | null;
  errors_by_class: PlatformErrors;
  charts_unusable: number;
  detail_loaded: boolean;
  measurement_complete: boolean;
}
/** Summary projection on run reads: dashboard results are independently paged. */
export interface PlatformSummary {
  schema: 1;
  target_kind: 'estishraf_platform';
  test_type: PlatformTestType;
  identity: { run_id: string; run_number: number; project_name: string; target_name: string };
  verdict: PerformanceVerdict;
  verdict_reason: string;
  source_verdict_reason: string;
  ended_by: 'plan' | 'auto_stop' | 'stop' | 'runner' | 'error';
  exit_code: number | null;
  started_at: string;
  ended_at: string;
  target_url: string;
  headline: PlatformHeadline;
  thresholds: {
    scope: 'run' | 'level';
    level: number | null;
    metric: 'dashboard_ready' | 'j_level_ready' | 'journey_errors' | 'j_level_errors';
    expression: string;
    measured: number | null;
    ok: boolean | null;
  }[];
  levels: PlatformSummaryLevel[];
  overall: {
    request_outcomes: number;
    failed_request_outcomes: number;
    error_rate_pct: number | null;
    errors_by_class: PlatformErrors;
    chart_unavailable_errors: number;
  };
  auth: {
    recovered: number;
    unrecovered: number;
    broker_pickups: number;
    refreshes: number;
    refresh_failures: number;
    waits: number;
    wait_recovered: number;
    incident: {
      first_failure_s: number;
      last_failure_s: number;
      contaminated_levels: number[];
      clean_levels: number[];
    } | null;
    handoffs: {
      phase: 'discovery' | 'load';
      rejected_at: string;
      recovered_at: string | null;
      deadline_at: string;
      outcome: 'recovered' | 'timed_out' | 'run_ended' | 'stopped';
    }[];
    handoffs_omitted: number;
  };
  counts: {
    planned_iterations: number | null;
    completed_iterations: number;
    records_received: number;
    records_dropped: number;
  };
  plan: PlatformResolvedPlan;
  coverage: PlatformCoverage;
  coverage_counts: PlatformCoverageCounts;
  measurements: {
    source_complete: boolean;
    percentiles_complete: boolean;
    percentile_basis: 'all_completed_steps';
    reason: 'source_records_missing' | 'sample_limit' | null;
    records_retained: number;
  };
}
export interface PlatformSummaryResult extends PlatformSummary {
  dashboards: PlatformDashboardRow[];
}

export interface PlatformRunRow extends Omit<
  PerformanceRunRow,
  | 'test_type'
  | 'target'
  | 'dataset'
  | 'p95_ms'
  | 'limit_ms'
  | 'answers_measured'
  | 'answers_total'
  | 'errors_total'
  | 'quality_mean'
> {
  target_kind: 'estishraf_platform';
  test_type: PlatformTestType;
  target: {
    id: string | null;
    name: string;
    kind: 'estishraf_platform';
    is_production: boolean;
    base_url: string;
  };
  p95_at_break_ms: number | null;
  open_p95_ms: number | null;
  filter_p95_ms: number | null;
  max_users: number;
  highest_tested_users: number | null;
  opens_measured: number | null;
  opens_total: number | null;
  filters_total: number | null;
  charts_drawn: number | null;
  charts_failed: number | null;
  discovery_counts: PlatformDiscoveryCounts | null;
  coverage: PlatformCoverage | null;
  coverage_counts: PlatformCoverageCounts | null;
}
export interface PlatformRunRead extends Omit<
  PerformanceRunRead,
  'run' | 'config' | 'progress' | 'summary' | 'token_needed' | 'tokens' | 'counts' | 'status_reason'
> {
  run: PlatformRunRow & Omit<PerformanceRunRead['run'], keyof PerformanceRunRow>;
  config: PlatformRunConfig;
  progress: PlatformProgress | null;
  summary: PlatformSummary | null;
  status_reason: { code: string; message: string } | null;
  token_needed: 'session_cookie' | null;
  tokens: PlatformTokenHint[];
  discovery: PlatformDiscovery | null;
  dashboard_results: { total: number; url: string };
  counts: {
    steps_received: number;
    steps_dropped: number;
    steps_stored: number;
    log_lines_received: number;
    log_lines_dropped: number;
    events: number;
  };
}
export interface PlatformActiveRun extends Pick<
  PlatformRunRow,
  | 'id'
  | 'number'
  | 'target_kind'
  | 'test_type'
  | 'status'
  | 'target'
  | 'requested_by'
  | 'requested_by_user_id'
  | 'requested_at'
  | 'started_at'
> {
  progress: PlatformProgress | null;
  seconds_since_report: number | null;
  stop_requested: boolean;
  token_needed: 'session_cookie' | null;
}
type ChatTarget<T> = T & { kind?: 'chat' };
type ChatRun<T> = T & { target_kind?: 'chat' };
export type MixedPerformanceTarget = ChatTarget<PerformanceTarget> | PlatformTarget;
export type MixedPerformanceRunRow = ChatRun<PerformanceRunRow> | PlatformRunRow;
export type MixedPerformanceRunRead =
  (PerformanceRunRead & { run: ChatRun<PerformanceRunRead['run']> }) | PlatformRunRead;
export type MixedPerformanceRunsFilters = PerformanceRunsFilters & { target_kind?: PerformanceTargetKind };
export interface MixedPerformanceRunsPage {
  rows: MixedPerformanceRunRow[];
  total: number;
  page: number;
  page_size: number;
}
export interface PlatformSetupOptions {
  supported: boolean;
  blocked: { code: string; message: string } | null;
  defaults: { test_type: 'breakpoint'; breakpoint: PlatformBreakpointPlan; smoke: PlatformSmokePlan };
  limits: Record<
    | Exclude<keyof PlatformCommonPlan, 'filters_per_dashboard' | 'max_dashboards'>
    | 'filters_per_dashboard'
    | 'max_dashboards'
    | 'baseline_users'
    | 'max_users'
    | 'step_users'
    | 'hold_seconds'
    | 'ramp_seconds'
    | 'users'
    | 'smoke_max_duration_seconds',
    [number, number]
  > & {
    max_total_seconds: number;
    dashboards_per_run_max: number;
    discovery_max_bytes: number;
    steps_per_run_max: number;
  };
  target_defaults: { settings: PlatformTargetSettings };
}
export interface PlatformSetup extends Omit<PerformanceSetup, 'targets'> {
  targets: (ChatTarget<PerformanceSetupTarget> | PlatformTarget)[];
  platform: PlatformSetupOptions;
}
export interface MixedPerformanceTargetsRead extends Omit<PerformanceTargetsRead, 'targets'> {
  targets: MixedPerformanceTarget[];
}
export interface PlatformCapacityCard {
  target: PerformanceRunRow['target'] | PlatformRunRow['target'];
  kind: PerformanceTargetKind;
  metric: 'dashboard_open_p95' | 'answer_p95';
  label: 'Dashboard open p95 at safe load' | 'Answer p95 at safe load';
  result: null | {
    run_id: string;
    number: number;
    finished_at: string;
    verdict: PerformanceVerdict;
    safe_load_users: number;
    breaking_level_users: number | null;
    recommended_max_users: number;
    p95_at_safe_load_ms: number | null;
    highest_tested_users: number;
    coverage: PlatformCoverage | null;
  };
}
export interface MixedPerformanceHome extends Omit<PerformanceHome, 'active_run' | 'targets' | 'runs'> {
  active_run: ChatRun<PerformanceActiveRun> | PlatformActiveRun | null;
  targets: (ChatTarget<PerformanceTargetSummary> | PlatformTarget)[];
  runs: MixedPerformanceRunsPage;
  capacity_cards: PlatformCapacityCard[];
  platform_safe_load_trend: (PerformanceHome['safe_load_trend'][number] & {
    kind: 'estishraf_platform';
    coverage: PlatformCoverage;
  })[];
}
export function isPlatformTarget<T extends object>(target: T): target is T & PlatformTarget {
  return 'kind' in target && target.kind === 'estishraf_platform';
}
export function isPlatformRun(run: MixedPerformanceRunRead): run is PlatformRunRead;
export function isPlatformRun(run: MixedPerformanceRunRow): run is PlatformRunRow;
export function isPlatformRun(run: MixedPerformanceHome['active_run']): run is PlatformActiveRun;
export function isPlatformRun(
  run: MixedPerformanceRunRead | MixedPerformanceRunRow | MixedPerformanceHome['active_run'],
): boolean {
  return Boolean(run && ('run' in run ? run.run.target_kind : run.target_kind) === 'estishraf_platform');
}
export interface PlatformStepRow {
  seq: number;
  at: string;
  elapsed_s: number;
  stage: PerformanceStageRole;
  level: number | null;
  user_number: number;
  type: 'open' | 'filter' | 'error';
  dashboard_id: PlatformId;
  title: string;
  insight_id: PlatformId | null;
  control: PlatformId | null;
  step:
    | 'dashboard'
    | 'background'
    | 'logo'
    | 'last-update'
    | 'siblings'
    | 'wrapper'
    | 'layout'
    | 'dependencies'
    | 'callback'
    | 'filter'
    | null;
  http_status: number | null;
  error_class: PlatformErrorClass | null;
  duration_ms: number | null;
  charts: number | null;
  charts_ok: number | null;
  errors: PlatformErrors;
}
export interface PlatformDiscoveryFilters {
  page?: number;
  page_size?: number;
  q?: string;
  runnable?: boolean;
}
export interface PlatformStepFilters {
  page?: number;
  page_size?: number;
  sort?: 'seq' | '-seq' | 'duration_ms' | '-duration_ms';
  after_seq?: number;
  type?: PlatformStepRow['type'][];
  stage?: PerformanceStageRole[];
  level?: number[];
  error_class?: PlatformErrorClass[];
  dashboard?: PlatformId[];
  has_errors?: boolean;
  q?: string;
}
export interface PlatformDashboardFilters {
  page?: number;
  page_size?: number;
  q?: string;
  dashboard?: PlatformId[];
  sort?: 'title' | '-title' | 'opens' | '-opens' | 'open_p95_ms' | '-open_p95_ms';
}
interface PlatformPage<T> {
  rows: T[];
  total: number;
  page: number;
  page_size: number;
}
export interface PlatformDiscoveryPage extends PlatformPage<PlatformDiscoveryRow> {
  discovery: PlatformDiscovery | null;
}
export interface PlatformStepsPage extends PlatformPage<PlatformStepRow> {
  last_seq: number;
  counts: { received: number; dropped: number; retained: number };
  facets: {
    types: PlatformStepRow['type'][];
    stages: PerformanceStageRole[];
    levels: number[];
    error_classes: PlatformErrorClass[];
  };
  details_expired: boolean;
}
export interface PlatformDashboardsPage extends PlatformPage<PlatformDashboardRow> {
  source: 'summary' | 'retained_steps';
  coverage: PlatformCoverage;
  coverage_counts: PlatformCoverageCounts;
  records_complete: boolean;
}

/** Canonical JSON keeps numeric/string IDs distinct and recursively sorts object keys. */
export function platformCanonicalId(id: PlatformId): string {
  const ordered = (value: PlatformJson): PlatformJson => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ordered(value[key]!)]),
      );
    return value;
  };
  return JSON.stringify(ordered(id));
}
function platformFilters(filters: object): Record<string, string | number | boolean | (string | number)[]> {
  const result: Record<string, string | number | boolean | (string | number)[]> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      const items = key === 'dashboard' ? value.map(platformCanonicalId) : [...value];
      result[key] = items.sort((a, b) =>
        typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
      );
    } else result[key] = value;
  }
  if ('after_seq' in result && !('sort' in result)) result.sort = 'seq';
  return result;
}
const runPath = (id: string, sub = '') => `/runs/${encodeURIComponent(id)}${sub}`;
export const platformPerformanceKeys = {
  home: (slug: string) => [...performanceKeys.all(slug), 'mixed-home'] as const,
  setup: (slug: string) => [...performanceKeys.all(slug), 'mixed-setup'] as const,
  targets: (slug: string) => [...performanceKeys.all(slug), 'mixed-targets'] as const,
  runs: (slug: string, filters: MixedPerformanceRunsFilters = {}) =>
    [...performanceKeys.all(slug), 'mixed-runs', platformFilters(filters)] as const,
  run: (slug: string, id: string) => [...performanceKeys.run(slug, id), 'platform'] as const,
  discovery: (slug: string, id: string, filters: PlatformDiscoveryFilters = {}) =>
    [...performanceKeys.run(slug, id), 'platform', 'discovery', platformFilters(filters)] as const,
  steps: (slug: string, id: string, filters: PlatformStepFilters = {}) =>
    [...performanceKeys.run(slug, id), 'platform', 'steps', platformFilters(filters)] as const,
  dashboards: (slug: string, id: string, filters: PlatformDashboardFilters = {}) =>
    [...performanceKeys.run(slug, id), 'platform', 'dashboards', platformFilters(filters)] as const,
};
async function received<T>(path: string): Promise<PerformanceReceived<T>> {
  return { ...(await performanceRead<T>(path)), received_at: Date.now() };
}
export function mixedPerformanceHomeQueryOptions(slug: string) {
  return queryOptions({
    queryKey: platformPerformanceKeys.home(slug),
    queryFn: () => received<MixedPerformanceHome>(performanceApiPath(slug)),
    refetchInterval: (query) =>
      query.state.data?.active_run ? PERFORMANCE_POLL_ACTIVE_MS : PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}
export function useMixedPerformanceHome(slug: string) {
  const query = useQuery(mixedPerformanceHomeQueryOptions(slug));
  const client = useQueryClient();
  const active = query.data?.active_run?.id ?? null;
  const last = useRef({ slug, active });
  useEffect(() => {
    const before = last.current;
    last.current = { slug, active };
    if (before.slug === slug && before.active && before.active !== active)
      void client.invalidateQueries({ queryKey: performanceKeys.all(slug) });
  }, [client, slug, active]);
  return query;
}
export function mixedPerformanceSetupQueryOptions(slug: string) {
  return queryOptions({
    queryKey: platformPerformanceKeys.setup(slug),
    queryFn: () => received<PlatformSetup>(performanceApiPath(slug, '/setup')),
    refetchInterval: PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}
export function useMixedPerformanceSetup(slug: string) {
  return useQuery(mixedPerformanceSetupQueryOptions(slug));
}
export function mixedPerformanceTargetsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: platformPerformanceKeys.targets(slug),
    queryFn: () => performanceRead<MixedPerformanceTargetsRead>(performanceApiPath(slug, '/targets')),
  });
}
export function useMixedPerformanceTargets(slug: string) {
  return useQuery(mixedPerformanceTargetsQueryOptions(slug));
}
export function mixedPerformanceRunsQueryOptions(slug: string, filters: MixedPerformanceRunsFilters = {}) {
  const queryKey = platformPerformanceKeys.runs(slug, filters);
  return queryOptions({
    queryKey,
    queryFn: () => performanceRead<MixedPerformanceRunsPage>(performanceApiPath(slug, '/runs', queryKey[4])),
    placeholderData: (previous, query) => (query?.queryKey[1] === slug ? previous : undefined),
  });
}
export function useMixedPerformanceRuns(slug: string, filters: MixedPerformanceRunsFilters = {}) {
  return useQuery(mixedPerformanceRunsQueryOptions(slug, filters));
}
export function mixedPerformanceRunQueryOptions(slug: string, runId: string) {
  return queryOptions({
    queryKey: platformPerformanceKeys.run(slug, runId),
    queryFn: () => received<MixedPerformanceRunRead>(performanceApiPath(slug, runPath(runId))),
    enabled: Boolean(runId),
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (isPerformanceRunActive(run?.effective_status)) return PERFORMANCE_POLL_ACTIVE_MS;
      return run?.late_results_until && Date.parse(run.late_results_until) > Date.parse(run.server_time)
        ? PERFORMANCE_POLL_IDLE_MS
        : false;
    },
  });
}
export function useMixedPerformanceRun(slug: string, runId: string) {
  const query = useQuery(mixedPerformanceRunQueryOptions(slug, runId));
  const client = useQueryClient();
  const run = query.data;
  const active = isPerformanceRunActive(run?.effective_status);
  const stored = run
    ? JSON.stringify([
        Boolean(run.summary),
        Boolean(run.report),
        'discovery' in run ? Boolean(run.discovery) : null,
        run.counts,
      ])
    : null;
  const last = useRef({ slug, runId, active, stored });
  useEffect(() => {
    const before = last.current;
    last.current = { slug, runId, active, stored };
    if (before.slug !== slug || before.runId !== runId || active || before.stored === null) return;
    if (!before.active && before.stored === stored) return;
    const own = hashKey(platformPerformanceKeys.run(slug, runId));
    void client.invalidateQueries({
      queryKey: performanceKeys.all(slug),
      predicate: (entry) => entry.queryHash !== own,
    });
  }, [client, slug, runId, active, stored]);
  return query;
}
function rowOptions<T>(
  slug: string,
  runId: string,
  kind: 'discovery' | 'steps' | 'dashboards',
  filters: object,
  { active = false, enabled = true }: PerformanceTailOptions,
) {
  const clean = platformFilters(filters);
  return queryOptions({
    queryKey: [...performanceKeys.run(slug, runId), 'platform', kind, clean] as const,
    queryFn: () => performanceRead<T>(performanceApiPath(slug, runPath(runId, `/${kind}`), clean)),
    enabled: enabled && Boolean(runId),
    refetchInterval: active ? PERFORMANCE_POLL_ACTIVE_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === slug && query.queryKey[4] === runId ? previous : undefined,
  });
}
export function platformDiscoveryQueryOptions(
  slug: string,
  runId: string,
  filters: PlatformDiscoveryFilters = {},
  options: PerformanceTailOptions = {},
) {
  return rowOptions<PlatformDiscoveryPage>(slug, runId, 'discovery', filters, options);
}
export function usePlatformDiscovery(
  slug: string,
  runId: string,
  filters: PlatformDiscoveryFilters = {},
  options: PerformanceTailOptions = {},
) {
  return useQuery(platformDiscoveryQueryOptions(slug, runId, filters, options));
}
export function platformStepsQueryOptions(
  slug: string,
  runId: string,
  filters: PlatformStepFilters = {},
  options: PerformanceTailOptions = {},
) {
  return rowOptions<PlatformStepsPage>(slug, runId, 'steps', filters, options);
}
export function usePlatformSteps(
  slug: string,
  runId: string,
  filters: PlatformStepFilters = {},
  options: PerformanceTailOptions = {},
) {
  return useQuery(platformStepsQueryOptions(slug, runId, filters, options));
}
export function platformDashboardsQueryOptions(
  slug: string,
  runId: string,
  filters: PlatformDashboardFilters = {},
  options: PerformanceTailOptions = {},
) {
  return rowOptions<PlatformDashboardsPage>(slug, runId, 'dashboards', filters, options);
}
export function usePlatformDashboards(
  slug: string,
  runId: string,
  filters: PlatformDashboardFilters = {},
  options: PerformanceTailOptions = {},
) {
  return useQuery(platformDashboardsQueryOptions(slug, runId, filters, options));
}
export function fetchPlatformSteps(slug: string, runId: string, filters: PlatformStepFilters = {}) {
  return performanceRead<PlatformStepsPage>(
    performanceApiPath(slug, runPath(runId, '/steps'), platformFilters(filters)),
  );
}
export function platformStepsCsvUrl(slug: string, runId: string, filters: PlatformStepFilters = {}): string {
  const { page: _page, page_size: _size, ...rest } = filters;
  return performanceApiPath(slug, runPath(runId, '/steps.csv'), platformFilters(rest));
}
export function useStartPlatformRun(slug: string) {
  return usePerformanceMutation(slug, (body: StartPlatformRunRequest) =>
    api.post<StartPlatformRunResponse>(performanceApiPath(slug, '/runs'), body),
  );
}
export function useSavePlatformTarget(slug: string) {
  return usePerformanceMutation(slug, ({ id, body }: { id?: string; body: SavePlatformTargetRequest }) =>
    id
      ? api.put<PlatformTarget>(performanceApiPath(slug, `/targets/${encodeURIComponent(id)}`), body)
      : api.post<PlatformTarget>(performanceApiPath(slug, '/targets'), body),
  );
}
interface SavePlatformSessionInput {
  targetId: string;
  body: SaveTargetTokenRequest;
}
const withoutSession = (input: SavePlatformSessionInput): SavePlatformSessionInput => ({
  ...input,
  body: { ...input.body, token: '' },
});
/** A credential response must not retain an echoed request body in the mutation cache. */
async function sessionWrite<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const safeCodes = new Set([
      'session_cookie_invalid',
      'validation_error',
      'validation',
      'forbidden',
      'production_requires_manager',
      'target_busy',
      'target_not_found',
      'target_archived',
      'encryption_key_missing',
      'wrong_target_kind',
      'run_not_found',
      'run_not_active',
      'token_not_requested',
      'token_version_conflict',
    ]);
    let code: string | undefined;
    if (error instanceof ApiError) {
      const body = error.body as { error?: { code?: unknown } } | undefined;
      const candidate = body?.error?.code ?? error.code;
      if (typeof candidate === 'string' && safeCodes.has(candidate)) code = candidate;
    }
    throw new ApiError(
      error instanceof ApiError ? error.status : 0,
      'The sign-in could not be saved. Paste it again and retry.',
      { code },
    );
  }
}
export function useSavePlatformSessionCookie(slug: string) {
  return useTokenWrite(
    slug,
    (input: SavePlatformSessionInput) =>
      sessionWrite(
        api.put<PlatformTokenHint>(
          performanceApiPath(slug, `/targets/${encodeURIComponent(input.targetId)}/tokens/session_cookie`),
          input.body,
        ),
      ),
    withoutSession,
  );
}
export interface PlatformSessionHandoffRequest extends SaveTargetTokenRequest {
  name: 'session_cookie';
}
const withoutHandoff = (input: PlatformSessionHandoffRequest): PlatformSessionHandoffRequest => ({
  ...input,
  token: '',
});
export function useHandOffPlatformSessionCookie(
  slug: string,
  runId: string,
  onSaved?: (version: number) => void,
) {
  return useTokenWrite(
    slug,
    async (body: PlatformSessionHandoffRequest) => {
      const saved = await sessionWrite(
        api.post<Pick<PlatformTokenHint, 'name' | 'hint' | 'version'>>(
          performanceApiPath(slug, runPath(runId, '/tokens')),
          body,
        ),
      );
      onSaved?.(saved.version);
      return saved;
    },
    withoutHandoff,
  );
}
export function useDeletePlatformSessionCookie(slug: string) {
  return usePerformanceMutation(slug, (targetId: string) =>
    api.delete<null>(
      performanceApiPath(slug, `/targets/${encodeURIComponent(targetId)}/tokens/session_cookie`),
    ),
  );
}
export const PLATFORM_TARGET_SETTINGS: PlatformTargetSettings = {
  client_id: 'estishraf',
  request_timeout_seconds: null,
  routes: {
    session: '/api/auth/session',
    token_refresh: '/api/auth/oauth2/token',
    health_check: '/api/user-management/user/health-check',
    my_topics: '/api/core/topic/user',
    dashboards: '/api/core/dashboard/client-dashboard?page={page}&pageSize={page_size}',
    dashboard: '/api/core/dashboard/client-dashboard/{dashboard_id}',
    dashboard_logo: '/api/core/dashboard/client-dashboard/{dashboard_id}/logo',
    latest_insights: '/api/core/insight/client-insight',
    dashboard_background: '/api/core/dashboard/background-image/{dashboard_id}',
    insight_last_update: '/api/core/insight/last-update/{insight_id}',
    siblings: '/api/core/dashboard/client-dashboard/?topicId={topic_id}',
    chart_wrapper: '/api/chart?insightId={insight_id}&theme={theme}',
    chart_layout: '/chart-assets/{insight_id}/_dash-layout?theme={theme}',
    chart_dependencies: '/chart-assets/{insight_id}/_dash-dependencies?theme={theme}',
    chart_callback: '/chart-assets/{insight_id}/_dash-update-component?theme={theme}',
  },
};
