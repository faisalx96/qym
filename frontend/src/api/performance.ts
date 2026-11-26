/**
 * Performance area: the page API. The contract comes first, as types only; the requests and hooks that
 * use it are at the end of the file (the Runner page's are in `performanceRunner.ts`).
 *
 * Draft contract of 2026-11-20, brought in line with DESIGN.md on 2026-11-22
 * (`REVIEW-2026-11-22.md`). Becomes `frontend/src/api/performance.ts` and
 * `frontend/src/api/performanceRunner.ts`; the Python payloads use the same field names.
 *
 * `B` below is `/api/projects/{project_slug}/performance`.
 * Shapes that the runner writes (run config, progress, summary) are defined in
 * `performance-runner-protocol-v1.0.md` sections 4.2, 4.3 and 4.7 and repeated here field for field.
 *
 * Units are in the names: `_s` seconds, `_seconds` whole seconds, `_ms` milliseconds, `_pct` 0-100,
 * `_rate` 0-1, `_at` an ISO timestamp in UTC. Token values never appear in any type of this file
 * except the two request bodies that carry a token a person typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hashKey,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
} from '@tanstack/react-query';
import { ApiError, api } from '@/lib/http';
import { bootstrap, platformUrl } from '@/lib/runtime';

/** Explicit representation opt-in for all Performance page reads. */
export const PERFORMANCE_READ_HEADERS = { 'X-Qym-Performance-Platform': '1' } as const;

export function performanceRead<T>(path: string): Promise<T> {
  return api.get<T>(path, { headers: PERFORMANCE_READ_HEADERS });
}

/** Fetch attachments with the representation header; a plain download link cannot send it. */
export async function downloadPerformanceFile(path: string): Promise<void> {
  const root = bootstrap().rootPath;
  const urlPath = root && path.startsWith(`${root}/`) ? path : performanceDownloadUrl(path);
  const response = await fetch(urlPath, {
    credentials: 'same-origin',
    headers: PERFORMANCE_READ_HEADERS,
  });
  if (!response.ok) throw new ApiError(response.status, 'The file could not be downloaded.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? 'performance-download';
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      /* Keep the plain filename. */
    }
  }
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------------------------
// Words shared by every route
// ---------------------------------------------------------------------------------------------

/** The three tests of the first version. Used by every route. */
export type PerformanceTestType = 'breakpoint' | 'smoke' | 'soak';

/** How far the process is, or how it ended. Never the result of the test: that is the verdict. */
export type PerformanceRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'finished'
  | 'stopped'
  | 'failed'
  | 'interrupted'
  | 'expired';

/** The suite's own words, stored as they are. The first four belong to Breakpoint, the last two to Smoke and Soak. */
export type PerformanceVerdict =
  'breakpoint_found' | 'not_reached' | 'invalid_auth' | 'invalid_no_data' | 'pass' | 'fail';

/** The three kinds of question; from the dataset item's `metadata.tier`. */
export type PerformanceTier = 'simple' | 'medium' | 'complex';
/** Why an answer counts as an error; 'network' covers timeouts. In progress, results and question rows. */
export type PerformanceErrorKind = 'auth' | 'rate_limit' | 'server' | 'network' | 'run_failed' | 'other';
/** How one level was judged: the suite's table words in lower case. 'auth' means sign-in errors, not counted. */
export type PerformanceLevelResult = 'pass' | 'break' | 'auth' | 'no_data';
/** Which limit a level broke: time, errors, or both. */
export type PerformanceBreakReason = 'latency' | 'errors' | 'both';
/** The two tokens of the one sign-in a target has. */
export type PerformanceTokenName = 'refresh_token' | 'access_token';
/** What a stage of the plan is; 'steady' is the single stage of Smoke and Soak. */
export type PerformanceStageRole = 'baseline' | 'ramp' | 'hold' | 'cooldown' | 'steady';
/** Level of a log line or an event. */
export type PerformanceLogLevel = 'info' | 'warning' | 'error';
/** Kind of a plan check: 'bad' means the run cannot start. */
export type PerformanceCheckTone = 'ok' | 'warn' | 'bad';

/** Share of each tier in percent. Integers that add up to 100. */
export type PerformanceMix = Record<PerformanceTier, number>;

/**
 * An error of any route, as the client holds it: `status` is the HTTP status, the other three are
 * `error.code`, `error.message` and `error.details` of the body. The body also keeps `detail` as an
 * alias of the message and `error.request_id`.
 * In the body `error.details` is `[]` when a refusal has none, every 404 among them; the client holds
 * `{}` then (`performanceError()` does that).
 * While the area is switched off on the platform (`QYM_PERFORMANCE_ENABLED=false`), every route of the
 * area, reads and writes, answers 404 "Performance is switched off" (code `performance_is_switched_off`).
 * That answer is in none of the lists below: test for it with `isPerformanceSwitchedOff()`.
 */
export interface PerformanceError<
  Status extends number,
  Code extends string,
  Details = Record<string, never>,
> {
  status: Status;
  code: Code;
  message: string;
  details: Details;
}

/** A body that failed validation (HTTP 422 with a detail array), on any write route. */
export type PerformanceValidationError = PerformanceError<
  422,
  'validation',
  { loc: (string | number)[]; msg: string; type: string }[]
>;

/**
 * A person who is not a member of the project, on any route of this area: the platform's own code.
 * A member whose role does not allow the action gets `forbidden` instead.
 */
export type PerformanceAccessDenied = PerformanceError<403, 'access_denied'>;

/** Every way a read (`GET`) of this area refuses. */
export type PerformanceReadError =
  | PerformanceAccessDenied
  // Every read of one run.
  | PerformanceError<404, 'run_not_found'>
  // `GET B/dataset-tiers`.
  | PerformanceError<404, 'dataset_version_not_found'>
  // `GET B/runs/{id}/report`: no report was stored, or retention has deleted it.
  | PerformanceError<404, 'report_not_found'>;

// ---------------------------------------------------------------------------------------------
// Runner status, as the pages see it
// ---------------------------------------------------------------------------------------------

/** Part of `GET B`, `GET B/setup`, `GET B/runs/{id}` and `GET B/runner`; polled with its parent. */
export interface PerformanceRunnerStatus {
  id: string;
  key: string;
  name: string;
  /** What the runner said about itself when it registered. */
  info: Record<string, unknown> & {
    supported_target_kinds?: ('chat' | 'estishraf_platform')[];
    runner_version?: string;
    k6_version?: string;
    suite_commit?: string;
    node_version?: string;
    host?: string;
    location?: string;
  };
  reported_state: 'idle' | 'preflight' | 'running' | 'stopping' | 'finishing' | null;
  current_run_id: string | null;
  /** When qym last heard from the runner (qym's clock). */
  last_heartbeat_at: string | null;
  seconds_since_heartbeat: number | null;
  /** Heard from within the "ready" limit (30 s by default): a run can be started. */
  fresh: boolean;
  /** Silent for longer than the limit that ends a run (120 s by default). */
  stale: boolean;
  /** A Manager chose the API key that receives the tokens. */
  runner_key_set: boolean;
  /** The runner last registered with the chosen key; null when no key is chosen or it never registered. */
  runner_key_matches: boolean | null;
  errors_last_hour: number;
  registered_at: string | null;
}

// ---------------------------------------------------------------------------------------------
// Home and history
// ---------------------------------------------------------------------------------------------

/** A target on Home and in filters. Part of `GET B`. */
export interface PerformanceTargetSummary {
  id: string;
  name: string;
  is_production: boolean;
  /** Host of the base URL, for display. */
  host: string;
  /** A refresh token is saved and not expired. */
  sign_in_ready: boolean;
  active_run_id: string | null;
  archived: boolean;
}

/**
 * One row of the history table. Returned in `GET B` (first page) and `GET B/runs`.
 * `status` here is the effective status (see `PerformanceRunRead.effective_status`).
 */
export interface PerformanceRunRow {
  id: string;
  /** The run's running number inside the project ("Run 24"). Not in the outline's table list: see OPEN-POINTS.md. */
  number: number;
  test_type: PerformanceTestType;
  status: PerformanceRunStatus;
  verdict: PerformanceVerdict | null;
  target: { id: string | null; name: string; is_production: boolean };
  dataset: { id: string; name: string; version: string };
  requested_by: string | null;
  requested_by_user_id: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  /** Breakpoint: the highest level that passed. */
  safe_load_users: number | null;
  breaking_level_users: number | null;
  breaking_reason: PerformanceBreakReason | null;
  /** Breakpoint: 80% of the safe load. */
  recommended_max_users: number | null;
  p95_at_safe_load_ms: number | null;
  /** Whole run, all levels mixed. */
  p95_ms: number | null;
  /** The time limit the run was judged against. */
  limit_ms: number;
  answers_measured: number | null;
  answers_total: number | null;
  errors_total: number | null;
  error_rate_pct: number | null;
  /** Most users active at once; for a run without a summary, the plan's highest level. */
  max_users: number | null;
  quality_mean: number | null;
  /** One sentence in plain words for a run that did not finish normally; null otherwise. */
  status_reason: string | null;
  note: string;
  has_report: boolean;
}

/** Query of `GET B/runs`. Arrays are repeated query parameters (`status=finished&status=stopped`). */
export interface PerformanceRunsFilters {
  page?: number;
  /** 1-200, default 25. */
  page_size?: number;
  status?: PerformanceRunStatus[];
  verdict?: PerformanceVerdict[];
  /** A target id. */
  target?: string;
  test_type?: PerformanceTestType[];
  /** Words to look for: a run number, a target, dataset or person name (case-insensitive). */
  q?: string;
}

/** `GET B/runs?page&page_size&status&verdict&target&test_type`. Not polled; read again when a run ends. */
export interface PerformanceRunsPage {
  rows: PerformanceRunRow[];
  total: number;
  page: number;
  page_size: number;
}

/** The run that is queued or active now, in short. Part of `GET B` and `GET B/runner`. */
export interface PerformanceActiveRun {
  id: string;
  number: number;
  test_type: PerformanceTestType;
  status: PerformanceRunStatus;
  target: { id: string | null; name: string; is_production: boolean };
  requested_by: string | null;
  /** For `UserName`: the person's id beside the display name. */
  requested_by_user_id: string | null;
  requested_at: string;
  started_at: string | null;
  elapsed_s: number | null;
  planned_s: number;
  phase: PerformanceProgress['phase'] | null;
  level: number | null;
  users: number | null;
  answers_finished: number | null;
  answers_in_flight: number | null;
  errors: number | null;
  p95_ms: number | null;
  limit_ms: number;
  stop_requested: boolean;
  token_needed: PerformanceTokenName | null;
  seconds_since_report: number | null;
  /**
   * The plan's stages, the same list as `config.plan.stages` of `GET B/runs/{id}`: planned users over
   * time, for the stepladder. With `elapsed_s` it places the "now" marker.
   */
  stages: PerformancePlanStage[];
  /**
   * One entry per level whose hold has begun, the same list as `progress.levels` of `GET B/runs/{id}`:
   * the outcome of each finished level and the picture so far of the one that runs. Empty for Smoke and
   * Soak and before the first hold.
   */
  levels: PerformanceProgressLevel[];
}

/**
 * `GET B`: the Home page. Polled every 15 s, every 5 s while `active_run` is not null
 * (the pattern of `useLiveWorker`). Not polled in a hidden tab.
 */
export interface PerformanceHome {
  server_time: string;
  /** Null until a runner has registered. */
  runner: PerformanceRunnerStatus | null;
  active_run: PerformanceActiveRun | null;
  targets: PerformanceTargetSummary[];
  /** First page of the history, newest first. */
  runs: PerformanceRunsPage;
  /** Safe load per finished Breakpoint run, oldest first, for the trend (at most the last 30 runs). */
  safe_load_trend: {
    run_id: string;
    number: number;
    target_id: string | null;
    finished_at: string;
    safe_load_users: number;
    breaking_level_users: number | null;
    max_users: number | null;
  }[];
  /** What this person may do, decided by the API. */
  can: { start: boolean; manage: boolean };
}

// ---------------------------------------------------------------------------------------------
// New run: setup data and start
// ---------------------------------------------------------------------------------------------

/** One saved token of a target: never the value. */
export interface PerformanceTokenHint {
  name: PerformanceTokenName;
  /** Its last 4 characters. */
  hint: string;
  /** Rises by 1 each time the token is replaced. */
  version: number;
  expires_at: string | null;
  expired: boolean;
  updated_at: string;
  /** Display name of the person who saved it; null when the runner reported a rotated token. */
  updated_by: string | null;
  /** Their id, for `UserName`; null as `updated_by`. */
  updated_by_user_id: string | null;
}

/**
 * A target on the New run page. Part of `GET B/setup`. Targets are added by a Manager; nothing is
 * built in and there is no fixed list of environments.
 */
export interface PerformanceSetupTarget {
  id: string;
  name: string;
  is_production: boolean;
  /** The address: scheme and host, without a path (the suite's BASE_URL). */
  base_url: string;
  /** Path of the chat route; the suite's unless the Manager changed it. */
  chat_path: string;
  /** Path of the sign-in renewal route; the suite's unless the Manager changed it. */
  token_refresh_path: string;
  /** The target's highest number of users, set by a Manager; null means only the platform limit applies. */
  max_users: number | null;
  /** Longest run allowed on this target, in seconds; null means only the platform limit applies. */
  max_duration_s: number | null;
  settings: {
    auth_server: string | null;
    refresh_cookie_name: string;
  };
  /** The sign-in hints: which tokens are saved. Empty when none. */
  tokens: PerformanceTokenHint[];
  /** A refresh token is saved and not expired. */
  sign_in_ready: boolean;
  /** A run is queued or active on this target: a second one is refused. */
  active_run_id: string | null;
  /** This person may start a run here (production needs a Manager). */
  can_start: boolean;
  /** This person may save or replace the tokens (the same rule as `can_start`). */
  can_save_tokens: boolean;
}

/** What the person sets for a run. Fields that do not belong to the test type are null. */
export interface PerformancePlanInput {
  /** Breakpoint. */
  baseline_users: number | null;
  max_users: number | null;
  step_users: number | null;
  hold_seconds: number | null;
  follow_up_rate: number | null;
  abort_on_break: boolean | null;
  /** Every test type. */
  limit_ms: number;
  max_error_rate_pct: number;
  timeout_seconds: number;
  /** Smoke and Soak. Smoke is always 1 user for 180 s. */
  users: number | null;
  duration_seconds: number | null;
  min_quality: number | null;
  max_no_data_pct: number | null;
}

/** One stage of a plan. Part of the run config (`GET B/runs/{id}`) and of `StartRunResponse`. */
export interface PerformancePlanStage {
  role: PerformanceStageRole;
  target_users: number;
  start_s: number;
  end_s: number;
}

/** One result of the plan rules. The cases in `plan-cases.json` fix codes, order and tones. */
export interface PerformancePlanCheck {
  code:
    | 'no_levels'
    | 'max_not_multiple_of_step'
    | 'timeout_below_limit'
    | 'hold_short'
    | 'hold_ok'
    | 'first_level_few_answers'
    | 'steady_ok'
    | 'over_max_users'
    | 'over_max_duration';
  tone: PerformanceCheckTone;
  message: string;
}

/** The plan with what qym computed from it. Stored in the run's config. */
export interface PerformancePlan extends PerformancePlanInput {
  levels: number[];
  total_seconds: number;
  warmup_seconds: number;
  stages: PerformancePlanStage[];
}

/** Lowest and highest value the start route accepts for each field. Part of `GET B/setup`. */
export interface PerformancePlanLimits {
  baseline_users: [number, number];
  max_users: [number, number];
  step_users: [number, number];
  hold_seconds: [number, number];
  /** Whole seconds only: a multiple of 1000. */
  limit_ms: [number, number];
  max_error_rate_pct: [number, number];
  follow_up_rate: [number, number];
  timeout_seconds: [number, number];
  users: [number, number];
  duration_seconds: [number, number];
  /** Longest planned length of any run, in seconds. */
  max_total_seconds: number;
  /**
   * Starts one person may make per hour, and how many are left for this person.
   * No limit: `starts_per_hour` is 0 and `starts_left` is null. Only `starts_left: 0` blocks a start.
   */
  starts_per_hour: number;
  starts_left: number | null;
}

/**
 * `GET B/setup`: everything the New run page needs except the datasets, which come from
 * `GET B/datasets`. Read when the page opens and every 15 s while it is open: runner freshness, sign-in
 * and "target busy" can change under the person.
 */
export interface PerformanceSetup {
  server_time: string;
  runner: PerformanceRunnerStatus | null;
  /** Targets that are not archived. */
  targets: PerformanceSetupTarget[];
  /** This person may add and edit targets from the New run page (Manager). */
  can_manage_targets: boolean;
  limits: PerformancePlanLimits;
  /** The values each test starts with. */
  defaults: Record<PerformanceTestType, { plan: PerformancePlanInput; mix: PerformanceMix }>;
  /** Tokens can be stored (the platform's encryption key is configured). */
  encryption_ready: boolean;
  /** Whether answers are stored with the questions by default, per kind of target. */
  store_answers_default: { production: boolean; other: boolean };
  /** Why no run can be started right now, whatever the form says; null when nothing blocks. */
  blocked:
    | null
    | {
        code:
          'runner_missing' | 'runner_stale' | 'runner_key_missing' | 'runner_busy' | 'encryption_key_missing';
        message: string;
        run_id?: string;
      }
    /** The runner registered under another key than the chosen one, or its key was deleted. */
    | { code: 'runner_key_mismatch'; message: string; run_id?: string };
}

/**
 * Per-tier counts of one dataset version, for the mix sliders and the "tier is empty" check.
 * No route of the outline returns this; proposed: `GET B/dataset-tiers?dataset_version_id=`
 * (see OPEN-POINTS.md). Read when the person picks a dataset; not polled.
 */
export interface PerformanceDatasetTiers {
  dataset_id: string;
  dataset_version_id: string;
  version: string;
  published: boolean;
  item_count: number;
  tier_counts: Record<PerformanceTier, number>;
  /** Items without a usable `metadata.tier`; the runner skips them, unless `single_kind` is true. */
  untiered: number;
  /**
   * No item has a `metadata.tier`: all questions count as one kind, and the mix is ignored and stored
   * as 100% medium (protocol 4.8; decision pending Ali). The page then turns the mix sliders off.
   */
  single_kind: boolean;
  follow_ups: number;
  /** False when a run cannot use this version, with the reason in words. */
  usable: boolean;
  reason: string | null;
}

/**
 * One dataset on the New run page (step 4). A row of `GET B/datasets`.
 * The counts are those of `latest_published_version`; of the newest draft when nothing is published.
 */
export interface PerformanceDataset {
  id: string;
  name: string;
  slug: string;
  /**
   * The version a run would use: its `id` is the `dataset_version_id` of `POST B/runs` and of
   * `GET B/dataset-tiers`, its `name` is what other types call `version`. Null when the dataset has only
   * a draft: it is listed, and a run cannot use it until a version is published.
   */
  latest_published_version: { id: string; name: string } | null;
  /** Number of questions. */
  item_count: number;
  /** Questions per kind, from `metadata.tier`. */
  tier_counts: Record<PerformanceTier, number>;
  follow_ups: number;
  /** No question has a kind: all count as one kind and the mix is ignored (as in `PerformanceDatasetTiers`). */
  single_kind: boolean;
  /** Display name of the person who last changed the dataset; null when not known. */
  updated_by: string | null;
  /** Their id, for `UserName`; null as `updated_by`. */
  updated_by_user_id: string | null;
  updated_at: string;
}

/**
 * `GET B/datasets`: the project's datasets a run could use. A dataset the start route would refuse with
 * `dataset_not_allowed` is not listed. Read when the New run page opens; not polled.
 */
export interface PerformanceDatasetsRead {
  datasets: PerformanceDataset[];
}

/** Body of `POST B/runs`. */
export interface StartRunRequest {
  target_id: string;
  test_type: PerformanceTestType;
  dataset_version_id: string;
  plan: PerformancePlanInput;
  mix: PerformanceMix;
  options?: { store_answers?: boolean };
  /** Up to 500 characters. */
  note?: string;
  /** Production target only: the target's name as the person typed it. The API compares it. */
  confirm_target?: string;
}

/** `POST B/runs` answered 201: the run is queued. */
export interface StartRunResponse {
  id: string;
  number: number;
  status: 'queued';
  requested_at: string;
  /** The plan as qym computed and stored it. */
  plan: PerformancePlan;
}

/**
 * Every way `POST B/runs` refuses, told apart by `code`.
 * 403: the person may not. 409: the system is not ready. 422: the request itself is wrong. 429: too many starts.
 * `mix_tier_empty` is also the answer for a dataset version without any question (`tiers` then lists the
 * kinds the mix asks for). `plan_invalid.details.checks` holds every check of the plan, not only the
 * ones that failed.
 */
export type StartRunError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<403, 'production_requires_manager'>
  | PerformanceError<404, 'target_not_found'>
  | PerformanceError<409, 'target_archived'>
  | PerformanceError<409, 'runner_missing'>
  | PerformanceError<409, 'runner_stale', { seconds_since_heartbeat: number | null }>
  | PerformanceError<409, 'runner_key_missing'>
  /** The runner registered under another key than the chosen one, or its key was deleted. */
  | PerformanceError<409, 'runner_key_mismatch'>
  | PerformanceError<409, 'runner_busy', { run_id: string }>
  | PerformanceError<409, 'target_busy', { run_id: string }>
  /** The target's address or sign-in settings changed while the start was under way. */
  | PerformanceError<409, 'target_changed', { target_id: string }>
  | PerformanceError<409, 'encryption_key_missing'>
  | PerformanceError<409, 'sign_in_missing', { missing: PerformanceTokenName[] }>
  | PerformanceError<409, 'token_expired', { name: PerformanceTokenName; expires_at: string }>
  | PerformanceError<422, 'dataset_not_found'>
  | PerformanceError<422, 'dataset_not_published', { status: string }>
  | PerformanceError<422, 'dataset_not_allowed', { reason: 'restricted' | 'private_test_set' }>
  | PerformanceError<422, 'mix_invalid', { sum: number }>
  | PerformanceError<422, 'mix_tier_empty', { tiers: PerformanceTier[] }>
  | PerformanceError<422, 'plan_invalid', { checks: PerformancePlanCheck[] }>
  | PerformanceError<
      422,
      'over_target_limit',
      { field: 'max_users' | 'total_seconds'; limit: number; value: number }
    >
  | PerformanceError<
      422,
      'over_platform_limit',
      { field: 'max_users' | 'total_seconds'; limit: number; value: number }
    >
  | PerformanceError<422, 'confirm_target_mismatch'>
  | PerformanceError<429, 'too_many_starts', { retry_after_s: number }>
  | PerformanceValidationError;

// ---------------------------------------------------------------------------------------------
// The run page
// ---------------------------------------------------------------------------------------------

/** The frozen settings of a run (protocol 4.2). Part of `GET B/runs/{id}`. */
export interface PerformanceRunConfig {
  schema: 1;
  test_type: PerformanceTestType;
  target: {
    id: string;
    name: string;
    is_production: boolean;
    base_url: string;
    chat_path: string;
    auth_server: string | null;
    token_refresh_path: string;
    refresh_cookie_name: string;
  };
  /** Which tokens were saved when the run was started. */
  tokens: { name: PerformanceTokenName; hint: string; version: number }[];
  plan: PerformancePlan;
  mix: PerformanceMix;
  dataset: {
    id: string;
    name: string;
    version_id: string;
    version: string;
    item_count: number;
    content_hash: string;
    tier_counts: Record<PerformanceTier, number>;
    /** No item has a tier: all questions count as one kind (protocol 4.8). */
    single_kind: boolean;
  };
  options: { store_answers: boolean; question_sent_lines: boolean };
  note: string;
}

/** One level in the live progress (protocol 4.3). */
export interface PerformanceProgressLevel {
  level: number;
  state: 'running' | 'done';
  hold_elapsed_pct: number;
  answers: number;
  errors: number;
  error_pct: number;
  auth_errors: number;
  interrupted: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  ttfb_p95_ms: number | null;
  per_minute: number;
  quality_mean: number | null;
  no_data_pct: number | null;
  /** While `state` is 'running': what the level looks like so far. */
  result: PerformanceLevelResult;
  reason: PerformanceBreakReason | null;
}

/**
 * The runner's last progress report, stored as it came (protocol 4.3). Part of `GET B/runs/{id}`.
 * A newer runner may add keys; the page ignores what it does not know.
 */
export interface PerformanceProgress {
  phase: 'preflight' | 'baseline' | 'ramp' | 'hold' | 'cooldown' | 'steady' | 'stopping' | 'finishing';
  step?: 'dataset' | 'sign_in' | 'plan_check' | 'starting_k6' | null;
  elapsed_s: number;
  planned_s: number;
  stage: (PerformancePlanStage & { index: number; of: number }) | null;
  /** The level being held; null outside a hold. */
  level: number | null;
  users: number | null;
  users_max: number | null;
  answers: {
    /** Null when the suite does not write a line for a sent question. */
    sent: number | null;
    finished: number;
    ok: number;
    errors: number;
    interrupted: number;
    in_flight: number | null;
    /** Age of the oldest answer in flight. */
    oldest_in_flight_s: number | null;
    follow_ups: number;
    warmup: number;
  };
  errors_by_kind: Record<PerformanceErrorKind, number>;
  /** Over all finished answers so far, all levels mixed. */
  p95_ms: number | null;
  ttfb_p95_ms: number | null;
  quality_mean: number | null;
  no_data_pct: number | null;
  /** One entry per level whose hold has begun; empty for Smoke and Soak. */
  levels: PerformanceProgressLevel[];
  auth: {
    state: 'ok' | 'rejected' | 'recovered';
    /** The version of each token the runner holds. */
    token_versions: Partial<Record<PerformanceTokenName, number>>;
    refresh_ok: number;
    refresh_failed: number;
    users_rejected: number;
    users_recovered: number;
    rejected_at: string | null;
    recovered_at: string | null;
  };
  waiting_for_token: PerformanceTokenName | null;
  dropped: { questions: number; log_lines: number };
}

/** One level of the result (protocol 4.7). */
export interface PerformanceSummaryLevel {
  level: number;
  /**
   * `answers`, `error_pct`, `per_minute` and `hold_elapsed_pct` are numbers when `has_data` is true; a level without
   * data may send them as null (protocol 4.7), and the page shows "–" for them.
   */
  answers: number | null;
  interrupted: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  ttfb_p50_ms: number | null;
  ttfb_p95_ms: number | null;
  error_pct: number | null;
  no_data_pct: number | null;
  auth_error_pct: number | null;
  auth_contaminated: boolean;
  quality_mean: number;
  follow_ups: number;
  per_minute: number | null;
  hold_start_s: number;
  hold_end_s: number;
  /** Optional (protocol): a runner may leave it out, or leave a kind out of it; the page then shows no per-kind value. */
  by_tier?: Partial<
    Record<PerformanceTier, { answers: number | null; avg_ms: number | null; p95_ms: number | null }>
  >;
  passed: boolean;
  latency_breach: boolean;
  error_breach: boolean;
  has_data: boolean;
  result: PerformanceLevelResult;
  /** How much of the hold had passed when the run ended; below 100 for a hold cut short. */
  hold_elapsed_pct: number | null;
}

/** One line per limit: limit, measured value, result. */
export interface PerformanceThreshold {
  scope: string;
  metric: string;
  expression: string;
  measured: number | null;
  ok: boolean;
}

/** The headline values of a result; every one may be null. */
export interface PerformanceHeadline {
  safe_load_users: number | null;
  breaking_level_users: number | null;
  breaking_reason: PerformanceBreakReason | null;
  recommended_max_users: number | null;
  p95_at_safe_load_ms: number | null;
  answers_measured: number | null;
  duration_s: number | null;
  p95_ms: number | null;
  answers_total: number | null;
  errors_total: number | null;
  error_rate_pct: number | null;
  ttfb_p95_ms: number | null;
  max_users: number | null;
  quality_mean: number | null;
}

/**
 * The stored result: the suite's own summary, renamed field by field (protocol 4.7).
 * Part of `GET B/runs/{id}`; null until the runner has sent it, and for a run whose k6 was killed.
 * `suite_summary` (the suite's file, unchanged) is stored but not sent to the page.
 */
export interface PerformanceSummary {
  schema: 1;
  test_type: PerformanceTestType;
  verdict: PerformanceVerdict;
  verdict_reason: string | null;
  /** Why the run ended: its plan's end, its own stop at a broken level, a person, the runner, an error. */
  ended_by: 'plan' | 'auto_stop' | 'stop' | 'runner' | 'error';
  exit_code: number | null;
  started_at: string;
  ended_at: string;
  target_url: string;
  headline: PerformanceHeadline;
  thresholds: PerformanceThreshold[];
  /** Breakpoint: one entry per planned level. Empty for Smoke and Soak. */
  levels: PerformanceSummaryLevel[];
  overall?: {
    http_requests: number | null;
    http_failed_rate: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
    max_ms: number | null;
    quality_mean: number | null;
    no_data_pct: number | null;
    checks_rate: number | null;
  };
  auth?: {
    refresh_ok: number;
    refresh_failed: number;
    refresh_transient: number;
    no_token: number;
    broker_pickups: number;
    first_refresh_failure_s: number | null;
    first_auth_error_s: number | null;
    refresh_token_rejected: boolean;
    incident: null | {
      first_failure_s: number | null;
      recovered_s: number | null;
      contaminated_levels: number[];
      clean_levels: number[];
    };
    clean_until_level: number | null;
  };
  counts?: {
    iterations: number | null;
    follow_ups: number | null;
    interrupted: number | null;
    by_tier: Record<PerformanceTier, number> | null;
  };
  /** The settings and stages the suite resolved by itself; compare with `config.plan`. */
  plan?: Record<string, unknown> & { stages?: PerformancePlanStage[] };
}

/** The stored report file. Part of `GET B/runs/{id}`. The file itself is `GET B/runs/{id}/report`, a download. */
export interface PerformanceReportMeta {
  byte_size: number;
  sha256: string;
  received_at: string;
  /** When retention will delete the file. */
  expires_at: string | null;
  /**
   * Address of the download (sent as an attachment, never shown as a page): a path without the
   * platform's root prefix. A link is `performanceDownloadUrl(url)`.
   */
  url: string;
}

/**
 * `GET B/runs/{id}`: the run page, live and finished.
 * Polled every 5 s while `effective_status` is queued, starting, running or stopping; after that every
 * 15 s until `late_results_until` has passed (the runner may still send the result), then no more.
 * `server_time` is read together with the client's own clock at arrival, so ages are shown without
 * trusting the two clocks to agree.
 */
export interface PerformanceRunRead {
  server_time: string;
  run: PerformanceRunRow & {
    /** The status as stored. The page shows `effective_status`. */
    stored_status: PerformanceRunStatus;
    claimed_at: string | null;
    /** When qym last received a progress report. */
    last_report_at: string | null;
    stop_requested_at: string | null;
    stop_requested_by: string | null;
    /** The id of the person who asked for the stop, for `UserName`. */
    stop_requested_by_user_id: string | null;
    stop_reason: string | null;
    /** The runner's own words for a failed or interrupted run. */
    error: string | null;
    exit_code: number | null;
  };
  /**
   * The status after the rules that are derived on read: a claimed run whose runner has been silent
   * past the limit is 'interrupted', an unclaimed run past the queue time is 'expired'. Equal to
   * `run.status`.
   */
  effective_status: PerformanceRunStatus;
  /** Why the run is in this status, for the first line of the page; null while all is normal. */
  status_reason: null | {
    code:
      | 'stopped_before_claim'
      | 'stopped_by_person'
      | 'preflight_failed'
      | 'k6_failed'
      | 'runner_restarted'
      | 'runner_silent'
      | 'runner_shutdown'
      | 'stopped_while_runner_silent'
      | 'not_claimed';
    message: string;
  };
  config: PerformanceRunConfig;
  /** Null until the first report. Kept after the end: an interrupted run shows what it reported. */
  progress: PerformanceProgress | null;
  seconds_since_report: number | null;
  runner: Pick<
    PerformanceRunnerStatus,
    'name' | 'reported_state' | 'seconds_since_heartbeat' | 'fresh' | 'stale'
  > | null;
  stop_requested: boolean;
  /** The token the runner waits for; the page then asks for it. */
  token_needed: PerformanceTokenName | null;
  /**
   * The target's tokens now. A version above `progress.auth.token_versions` means a new token is saved
   * and the runner has not checked it yet.
   */
  tokens: PerformanceTokenHint[];
  summary: PerformanceSummary | null;
  /** Null when no report was stored. `report_expired` tells a deleted file from one that never came. */
  report: PerformanceReportMeta | null;
  report_expired: boolean;
  counts: {
    questions_received: number;
    questions_dropped: number;
    log_lines_received: number;
    log_lines_dropped: number;
    events: number;
  };
  /** Until when the runner may still send results of a run that has ended; null before the end. */
  late_results_until: string | null;
  /** What this person may do on this run, decided by the API. */
  can: { stop: boolean; hand_off_token: boolean };
}

/** One asked question. A row of `GET B/runs/{id}/questions`. */
export interface PerformanceQuestionRow {
  seq: number;
  asked_at: string;
  /** Seconds since k6 started, when the question was sent. */
  elapsed_s: number;
  stage: PerformanceStageRole;
  /** The level this answer is counted in; null when no level counts it. */
  level: number | null;
  /** Number of the simulated user. */
  user: number;
  tier: PerformanceTier;
  /** The dataset item's id. */
  question_id: string;
  is_followup: boolean;
  question: string;
  status: 'ok' | 'error' | 'interrupted';
  http_status: number;
  error_kind: PerformanceErrorKind | null;
  duration_ms: number;
  /** Time to the first byte. */
  ttfb_ms: number | null;
  quality: number | null;
  no_data: boolean;
  warmup: boolean;
  attempts: number;
  /** The first 1,000 characters; null when the run does not store answers. */
  answer: string | null;
  answer_truncated: boolean;
}

/** Query of `GET B/runs/{id}/questions` and of `questions.csv`. Arrays are repeated query parameters. */
export interface PerformanceQuestionFilters {
  /** Live tail: only rows with a higher `seq`, oldest first. Not combined with `page`. */
  after_seq?: number;
  page?: number;
  /** 1-200, default 50. */
  page_size?: number;
  status?: PerformanceQuestionRow['status'][];
  level?: number[];
  tier?: PerformanceTier[];
  followup?: boolean;
  no_data?: boolean;
  /** Text in the question, the answer or the question id. */
  q?: string;
  /** Default '-seq' (newest first). */
  sort?: 'seq' | '-seq' | 'duration_ms' | '-duration_ms' | 'ttfb_ms' | '-ttfb_ms';
}

/**
 * `GET B/runs/{id}/questions?after_seq&page&page_size&status&level&tier&followup&no_data&q&sort`.
 * While the run is active the page asks every 5 s with `after_seq` = the highest `seq` it holds and
 * adds the rows; a finished run is read once per filter or page change.
 * `GET B/runs/{id}/questions.csv` takes the same filters and returns a file.
 */
export interface PerformanceQuestionsPage {
  rows: PerformanceQuestionRow[];
  /** Rows that match the filters. */
  total: number;
  page: number;
  page_size: number;
  /** The highest `seq` stored for the run, whatever the filters. */
  last_seq: number;
  /** Counts over the whole run, for the filter controls. */
  facets: {
    statuses: Record<PerformanceQuestionRow['status'], number>;
    tiers: Record<PerformanceTier, number>;
    /** Key: the level; 'none' for answers no level counts. */
    levels: Record<string, number>;
    error_kinds: Partial<Record<PerformanceErrorKind, number>>;
    followups: number;
    no_data: number;
  };
}

/** One line of the run's log. */
export interface PerformanceLogLine {
  seq: number;
  at: string;
  level: PerformanceLogLevel;
  message: string;
}

/** Query of `GET B/runs/{id}/log`. */
export interface PerformanceLogFilters {
  /** Only lines with a higher `seq`. Default 0. */
  after_seq?: number;
  /** 1-1000, default 500. */
  limit?: number;
  level?: PerformanceLogLevel[];
  q?: string;
}

/**
 * `GET B/runs/{id}/log?after_seq&limit&level&q`: lines in `seq` order after `after_seq`.
 * While the run is active the page asks every 5 s from the highest `seq` it holds; when
 * `next_after_seq` is not null there is more and the page asks again at once.
 * `GET B/runs/{id}/log.txt` returns the whole log as a file.
 */
export interface PerformanceLogPage {
  lines: PerformanceLogLine[];
  /** Pass as `after_seq` for the next lines; null when these were the last. */
  next_after_seq: number | null;
  /** The highest `seq` stored for the run. */
  last_seq: number;
  /** Lines that match the filters, in the whole log. */
  total: number;
  /** Lines the runner or qym had to drop. */
  dropped: number;
}

/** One entry of a timeline: reported by the runner, or written by qym itself. */
export interface PerformanceEvent {
  id: number;
  at: string;
  level: PerformanceLogLevel;
  code: string;
  message: string;
  details: Record<string, unknown>;
  source: 'runner' | 'qym';
  run_id: string | null;
}

/**
 * `GET B/runs/{id}/events`: the run's timeline, oldest first; at most the newest 1,000 entries.
 * Polled every 5 s while the run is active.
 */
export interface PerformanceRunEvents {
  events: PerformanceEvent[];
}

/** Body of `POST B/runs/{id}/stop`. */
export interface StopRunRequest {
  /** Up to 500 characters; shown on the run page and sent to the runner. */
  reason?: string;
}

/**
 * `POST B/runs/{id}/stop` answered 200. A repeat is also 200.
 * `outcome` says what the press did: a queued run is stopped at once; an active run gets a stop
 * request that the runner picks up within seconds; a run whose runner is silent is ended as
 * interrupted at once; a run that had already ended is left as it is.
 */
export interface StopRunResponse {
  id: string;
  status: PerformanceRunStatus;
  outcome: 'stopped' | 'stop_requested' | 'interrupted' | 'already_ended';
  stop_requested_at: string | null;
}

/** Every way `POST B/runs/{id}/stop` refuses. Stop is allowed for a Member, also in an archived project. */
export type StopRunError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<404, 'run_not_found'>
  | PerformanceValidationError;

/** Body of `POST B/runs/{id}/tokens`: a new token for the run's target, handed over while the run goes on. */
export interface TokenHandoffRequest {
  name: PerformanceTokenName;
  /** The token as the person pasted it. Write-only: no route ever returns it. */
  token: string;
  expires_at?: string | null;
}

/** `POST B/runs/{id}/tokens` answered 200: the token is saved for the target and `token_needed` is cleared. */
export interface TokenHandoffResponse {
  name: PerformanceTokenName;
  hint: string;
  version: number;
}

/**
 * Every way `POST B/runs/{id}/tokens` refuses. A token that is missing, empty or not text answers
 * `token_empty`, never a validation answer: no token can come back in an error.
 */
export type TokenHandoffError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<403, 'production_requires_manager'>
  | PerformanceError<404, 'run_not_found'>
  | PerformanceError<409, 'run_ended', { status: PerformanceRunStatus }>
  | PerformanceError<409, 'target_missing'>
  | PerformanceError<409, 'encryption_key_missing'>
  | PerformanceError<422, 'token_empty'>
  | PerformanceValidationError;

// ---------------------------------------------------------------------------------------------
// Targets and tokens
// ---------------------------------------------------------------------------------------------

/** A target with everything the Add / Edit target dialog and the Targets list show. A row of `GET B/targets`. */
export interface PerformanceTarget extends PerformanceSetupTarget {
  /** Not null for an archived target: kept for the history, hidden from the New run page. */
  archived_at: string | null;
  created_by: string | null;
  /** The creator's id, for `UserName`. */
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  last_run: null | {
    id: string;
    number: number;
    status: PerformanceRunStatus;
    verdict: PerformanceVerdict | null;
    finished_at: string | null;
  };
}

/** `GET B/targets`. Read when the page opens and after each write; not polled. */
export interface PerformanceTargetsRead {
  targets: PerformanceTarget[];
  /** This person may create, change and archive targets (Manager). */
  can_manage: boolean;
  encryption_ready: boolean;
  /** The platform's own caps: a target's limits cannot exceed them. */
  platform_limits: { max_users: number; max_duration_s: number };
}

/**
 * Body of `POST B/targets` (answers 201 with the `PerformanceTarget`) and `PUT B/targets/{id}`
 * (answers 200 with it). `DELETE B/targets/{id}` archives the target and answers 204: a target that
 * has runs is never deleted. Manager only.
 * Changing `base_url` removes the target's saved tokens: the answer then has `tokens: []` and
 * `sign_in_ready: false`. Runs that exist keep the address they ran against (their own config).
 * On `PUT`, an absent `chat_path` or `token_refresh_path` keeps the stored value, and an absent
 * `max_users` or `max_duration_s` becomes null: send both limits with every change.
 */
export interface SaveTargetRequest {
  /** 1-200 characters; no other target of the project that is not archived has the same name. */
  name: string;
  is_production: boolean;
  /** The address: origin with scheme, without a path. No other target that is not archived has the same one. */
  base_url: string;
  /** Default: the suite's chat path, '/change/api/chat'. */
  chat_path?: string;
  /** Default: the suite's sign-in renewal path, '/auth/token'. */
  token_refresh_path?: string;
  settings?: Partial<PerformanceTarget['settings']>;
  /** The highest number of users a plan may reach on this target; null or absent: no limit of its own. */
  max_users?: number | null;
  max_duration_s?: number | null;
}

/**
 * Every way `POST B/targets`, `PUT B/targets/{id}` and `DELETE B/targets/{id}` refuse.
 * `target_archived`: a change to an archived target (restore it first). `target_busy`: a run uses the
 * target and the change is its address or where its sign-in goes (sign-in host, renewal path, refresh
 * cookie name), or the call archives it; a new name during a run is allowed. Such a change also removes
 * the saved tokens: the answer's `tokens` is then empty and the sign-in must be pasted again.
 */
export type SaveTargetError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<404, 'target_not_found'>
  | PerformanceError<409, 'target_archived'>
  | PerformanceError<409, 'target_name_taken'>
  | PerformanceError<409, 'target_address_taken', { target_id: string; name: string }>
  | PerformanceError<409, 'target_busy', { run_id: string }>
  | PerformanceError<
      422,
      'over_platform_limit',
      { field: 'max_users' | 'max_duration_s'; limit: number; value: number }
    >
  | PerformanceValidationError;

/**
 * Every way `POST B/targets/{id}/restore` refuses. The call takes no body, brings an archived target
 * back and answers 200 with the `PerformanceTarget`. Manager only. It is refused while another target
 * that is not archived uses the same name or the same address.
 */
export type RestoreTargetError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<404, 'target_not_found'>
  | PerformanceError<409, 'target_name_taken'>
  | PerformanceError<409, 'target_address_taken', { target_id: string; name: string }>;

/**
 * Body of `PUT B/targets/{id}/tokens/{name}`: save or replace one token. Answers 200 with the
 * `PerformanceTokenHint`. Allowed for whoever may start a run on the target.
 * `DELETE B/targets/{id}/tokens/{name}` removes it and answers 204.
 */
export interface SaveTargetTokenRequest {
  /** Write-only. */
  token: string;
  expires_at?: string | null;
}

/**
 * Every way `PUT` and `DELETE B/targets/{id}/tokens/{name}` refuse.
 * `target_archived`: saving a token of an archived target. `target_busy`: removing a token while a run
 * uses the target. A token that is missing, empty or not text answers `token_empty`, never a
 * validation answer.
 */
export type SaveTargetTokenError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<403, 'production_requires_manager'>
  | PerformanceError<404, 'target_not_found'>
  | PerformanceError<409, 'target_archived'>
  | PerformanceError<409, 'target_busy', { run_id: string }>
  | PerformanceError<409, 'encryption_key_missing'>
  | PerformanceError<422, 'token_empty'>
  | PerformanceValidationError;

// ---------------------------------------------------------------------------------------------
// The Runner page
// ---------------------------------------------------------------------------------------------

/** The API key that receives the tokens. */
export interface PerformanceRunnerKey {
  id: string;
  name: string;
  prefix: string;
  changed_at: string | null;
  changed_by: string | null;
  /** The id of the person who chose the key, for `UserName`. */
  changed_by_user_id: string | null;
}

/** `GET B/runner`: the Runner page. Polled every 15 s, every 5 s while `active_run` is not null. */
export interface PerformanceRunnerRead {
  server_time: string;
  /** Null until a runner has registered. */
  runner: PerformanceRunnerStatus | null;
  runner_key: PerformanceRunnerKey | null;
  /** The project's API keys a Manager can choose from; empty for a person who is not a Manager. */
  api_keys: Pick<PerformanceRunnerKey, 'id' | 'name' | 'prefix'>[];
  active_run: PerformanceActiveRun | null;
  /** How many problems and notes the runner has (the Events table's loading rows follow it). */
  events_total: number;
  /** The limits this qym applies, in seconds. */
  settings: {
    fresh_within_s: number;
    stale_after_s: number;
    queue_timeout_s: number;
    late_window_s: number;
  };
  /** What an operator types into the runner's configuration. */
  connect: { project_id: string; runner_path: string };
  /** This person may choose the runner key (Manager). */
  can_manage: boolean;
}

/** Body of `PUT B/runner/key`. Null removes the choice: no key receives tokens and no run can start. */
export interface SetRunnerKeyRequest {
  api_key_id: string | null;
}

/** `PUT B/runner/key` answered 200. */
export interface SetRunnerKeyResponse {
  runner_key: PerformanceRunnerKey | null;
}

/** Every way `PUT B/runner/key` refuses. Manager only. */
export type SetRunnerKeyError =
  | PerformanceAccessDenied
  | PerformanceError<403, 'forbidden'>
  | PerformanceError<404, 'api_key_not_found'>
  | PerformanceError<409, 'api_key_revoked'>
  | PerformanceError<409, 'runner_busy', { run_id: string }>
  | PerformanceValidationError;

/** Query of `GET B/runner/events`. */
export interface PerformanceRunnerEventsFilters {
  page?: number;
  /** 1-100, default 10. */
  limit?: number;
  level?: PerformanceLogLevel[];
  /** Words to look for in the message (case-insensitive). */
  q?: string;
}

/** `GET B/runner/events?page&limit&level`: the runner's problems and notes, newest first. Polled every 15 s. */
export interface PerformanceRunnerEvents {
  events: PerformanceEvent[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------------------------
// Requests and hooks
// ---------------------------------------------------------------------------------------------

/** How often a page asks again while a run is queued or active (the contract above; as `useLiveWorker`). */
export const PERFORMANCE_POLL_ACTIVE_MS = 5000;
/** How often a page asks again while nothing runs. */
export const PERFORMANCE_POLL_IDLE_MS = 15000;

/** The statuses in which a run still changes. `GET B/runs/{id}` is polled only in these. */
export const PERFORMANCE_ACTIVE_STATUSES: readonly PerformanceRunStatus[] = [
  'queued',
  'starting',
  'running',
  'stopping',
];

export function isPerformanceRunActive(status: PerformanceRunStatus | null | undefined): boolean {
  return status != null && PERFORMANCE_ACTIVE_STATUSES.includes(status);
}

/** A read with the client's clock at its arrival, to show ages without trusting both clocks to agree. */
export type PerformanceReceived<T> = T & { received_at: number };

async function received<T>(request: Promise<T>): Promise<PerformanceReceived<T>> {
  const data = await request;
  return { ...data, received_at: Date.now() };
}

/** What the tail hooks take: `active` polls while the run goes on, `enabled: false` holds the request back. */
export interface PerformanceTailOptions {
  active?: boolean;
  enabled?: boolean;
}

const segment = encodeURIComponent;

/**
 * `B` + `sub` + the query. An array becomes a repeated parameter, `0` and `false` are sent, and a value
 * that is absent, null or an empty text is left out.
 */
export function performanceApiPath(slug: string, sub = '', query: object = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
    else if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return `/api/projects/${segment(slug)}/performance${sub}${text ? `?${text}` : ''}`;
}

const runSub = (runId: string, sub = '') => `/runs/${segment(runId)}${sub}`;

const inOrder = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

/**
 * Filters as they go into a cache key and into the query: without absent values, empty text and empty
 * lists, and with each list in one order, so that one request is one cache entry. `0` and `false` stay.
 */
function cleanFilters<T extends object>(filters: T): T {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (!Array.isArray(value)) clean[key] = value;
    else if (value.length) clean[key] = [...value].sort(inOrder);
  }
  return clean as T;
}

/**
 * Cache keys. Each starts with `all(slug)`, so one invalidation reaches the whole area; the questions, log
 * and events of a run start with that run's key. Filters are cleaned first (`cleanFilters`), and the
 * requests read them back from the key.
 */
export const performanceKeys = {
  all: (slug: string) => ['project', slug, 'performance'] as const,
  home: (slug: string) => ['project', slug, 'performance', 'home'] as const,
  runs: (slug: string, filters: PerformanceRunsFilters = {}) =>
    ['project', slug, 'performance', 'runs', cleanFilters(filters)] as const,
  setup: (slug: string) => ['project', slug, 'performance', 'setup'] as const,
  datasets: (slug: string) => ['project', slug, 'performance', 'datasets'] as const,
  datasetTiers: (slug: string, datasetVersionId: string) =>
    ['project', slug, 'performance', 'dataset-tiers', datasetVersionId] as const,
  run: (slug: string, runId: string) => ['project', slug, 'performance', 'run', runId] as const,
  runQuestions: (slug: string, runId: string, filters: PerformanceQuestionFilters = {}) =>
    ['project', slug, 'performance', 'run', runId, 'questions', cleanFilters(filters)] as const,
  runLog: (slug: string, runId: string, filters: PerformanceLogFilters = {}) =>
    ['project', slug, 'performance', 'run', runId, 'log', cleanFilters(filters)] as const,
  runEvents: (slug: string, runId: string) =>
    ['project', slug, 'performance', 'run', runId, 'events'] as const,
  targets: (slug: string) => ['project', slug, 'performance', 'targets'] as const,
  runner: (slug: string) => ['project', slug, 'performance', 'runner'] as const,
  runnerEvents: (slug: string, filters: PerformanceRunnerEventsFilters = {}) =>
    ['project', slug, 'performance', 'runner', 'events', cleanFilters(filters)] as const,
};

/**
 * A refused request as the contract describes it (`StartRunError` and the like), read from the client's
 * error: the message is the API's own sentence. Null when the error is not an answer of the API (no
 * network, a cancelled request). The platform's `validation_error` is given as the contract's `validation`.
 * An answer that is not the platform's own JSON (a proxy's error page, plain text) has an empty `code`
 * and a short sentence with the status as its message, never the text that came.
 */
export function performanceError<E extends PerformanceError<number, string, unknown>>(
  error: unknown,
): E | null {
  if (!(error instanceof ApiError)) return null;
  const body =
    error.body && typeof error.body === 'object'
      ? (error.body as { error?: unknown; detail?: unknown })
      : null;
  const envelope =
    body?.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : {};
  const sent = typeof envelope.code === 'string' ? envelope.code : (error.code ?? '');
  const code = sent === 'validation_error' ? 'validation' : sent;
  const own =
    typeof envelope.message === 'string' && envelope.message
      ? envelope.message
      : typeof body?.detail === 'string'
        ? body.detail
        : '';
  const message = own || `The request failed (error ${error.status}).`;
  const none = envelope.details == null || (Array.isArray(envelope.details) && !envelope.details.length);
  const details = none && code !== 'validation' ? {} : (envelope.details ?? []);
  return { status: error.status, code, message, details } as E;
}

/**
 * True for the answer every route of this area gives while the area is switched off on the platform:
 * 404 "Performance is switched off". A page shows a plain empty state for it, not an error with Retry.
 */
export function isPerformanceSwitchedOff(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  return (
    error.code === 'performance_is_switched_off' ||
    /^performance is switched off\.?$/i.test(error.detail.trim())
  );
}

/**
 * Reads the whole area again, once, when the run named by `activeRunId` is no longer the active one: the
 * history, the targets and the last rows of the run change at that moment and are not polled.
 */
function useRefreshWhenRunEnds(slug: string, activeRunId: string | null): void {
  const client = useQueryClient();
  const last = useRef({ slug, activeRunId });
  useEffect(() => {
    const before = last.current;
    last.current = { slug, activeRunId };
    if (before.slug === slug && before.activeRunId && before.activeRunId !== activeRunId)
      void client.invalidateQueries({ queryKey: performanceKeys.all(slug) });
  }, [client, slug, activeRunId]);
}

/** `GET B`: every 15 s, every 5 s while a run is queued or active; not in a hidden tab. */
export function performanceHomeQueryOptions(slug: string) {
  return queryOptions({
    queryKey: performanceKeys.home(slug),
    queryFn: () => received(performanceRead<PerformanceHome>(performanceApiPath(slug))),
    refetchInterval: (query) =>
      query.state.data?.active_run ? PERFORMANCE_POLL_ACTIVE_MS : PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}

/** The Home page. When the active run ends, the rest of the area is read again. */
export function usePerformanceHome(slug: string) {
  const query = useQuery(performanceHomeQueryOptions(slug));
  useRefreshWhenRunEnds(slug, query.data?.active_run?.id ?? null);
  return query;
}

/** `GET B/runs`: one page of the history. Not polled; the previous page stays while the next one loads. */
export function performanceRunsQueryOptions(slug: string, filters: PerformanceRunsFilters = {}) {
  const queryKey = performanceKeys.runs(slug, filters);
  return queryOptions({
    queryKey,
    queryFn: () => performanceRead<PerformanceRunsPage>(performanceApiPath(slug, '/runs', queryKey[4])),
    placeholderData: (previous, query) => (query?.queryKey[1] === slug ? previous : undefined),
  });
}

export function usePerformanceRuns(slug: string, filters: PerformanceRunsFilters = {}) {
  return useQuery(performanceRunsQueryOptions(slug, filters));
}

/** `GET B/setup`: every 15 s while the New run page is open; not in a hidden tab. */
export function performanceSetupQueryOptions(slug: string) {
  return queryOptions({
    queryKey: performanceKeys.setup(slug),
    queryFn: () => received(performanceRead<PerformanceSetup>(performanceApiPath(slug, '/setup'))),
    refetchInterval: PERFORMANCE_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceSetup(slug: string) {
  return useQuery(performanceSetupQueryOptions(slug));
}

/** `GET B/datasets`: read when the New run page opens, and again after a write of this area; not polled. */
export function performanceDatasetsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: performanceKeys.datasets(slug),
    queryFn: () => performanceRead<PerformanceDatasetsRead>(performanceApiPath(slug, '/datasets')),
  });
}

export function usePerformanceDatasets(slug: string) {
  return useQuery(performanceDatasetsQueryOptions(slug));
}

/** `GET B/dataset-tiers`: read when a dataset version is chosen; nothing is asked without one. */
export function performanceDatasetTiersQueryOptions(slug: string, datasetVersionId: string | null) {
  return queryOptions({
    queryKey: performanceKeys.datasetTiers(slug, datasetVersionId ?? ''),
    queryFn: () =>
      performanceRead<PerformanceDatasetTiers>(
        performanceApiPath(slug, '/dataset-tiers', { dataset_version_id: datasetVersionId }),
      ),
    enabled: Boolean(datasetVersionId),
  });
}

export function usePerformanceDatasetTiers(slug: string, datasetVersionId: string | null) {
  return useQuery(performanceDatasetTiersQueryOptions(slug, datasetVersionId));
}

/** The runner may still send the result of this ended run. Both times are the server's: no client clock. */
function lateResultsOpen(
  run: Partial<Pick<PerformanceRunRead, 'server_time' | 'late_results_until'>>,
): boolean {
  if (!run.late_results_until || !run.server_time) return false;
  return Date.parse(run.late_results_until) > Date.parse(run.server_time);
}

/**
 * `GET B/runs/{id}`: every 5 s while the run is queued, starting, running or stopping; after that every
 * 15 s until the time for late results has passed; then no more.
 */
export function performanceRunQueryOptions(slug: string, runId: string) {
  return queryOptions({
    queryKey: performanceKeys.run(slug, runId),
    queryFn: () => received(performanceRead<PerformanceRunRead>(performanceApiPath(slug, runSub(runId)))),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const run = query.state.data;
      if (isPerformanceRunActive(run?.effective_status)) return PERFORMANCE_POLL_ACTIVE_MS;
      return run && lateResultsOpen(run) ? PERFORMANCE_POLL_IDLE_MS : false;
    },
    refetchIntervalInBackground: false,
  });
}

/**
 * After its end a run may still receive its result. When a later read of the run shows more than the
 * one before (the result, the report, more questions, log lines or events), the run's rows and the rest
 * of the area are read again. The run read itself is not: it is the one that brought the news.
 */
function useRefreshWhenLateResultsArrive(slug: string, runId: string, run: PerformanceRunRead | undefined) {
  const client = useQueryClient();
  const counts: Partial<PerformanceRunRead['counts']> = run?.counts ?? {};
  const stored =
    run && !isPerformanceRunActive(run.effective_status)
      ? [
          run.summary ? 1 : 0,
          run.report ? 1 : 0,
          counts.questions_received,
          counts.log_lines_received,
          counts.events,
        ].join('/')
      : null;
  const last = useRef({ slug, runId, stored });
  useEffect(() => {
    const before = last.current;
    last.current = { slug, runId, stored };
    const sameRun = before.slug === slug && before.runId === runId;
    if (!sameRun || before.stored === null || stored === null || before.stored === stored) return;
    const own = hashKey(performanceKeys.run(slug, runId));
    void client.invalidateQueries({
      queryKey: performanceKeys.all(slug),
      predicate: (query) => query.queryHash !== own,
    });
  }, [client, slug, runId, stored]);
}

/**
 * The run page. When the run ends, its questions, log and events and the rest of the area are read again;
 * the same happens when a result arrives after the end.
 */
export function usePerformanceRun(slug: string, runId: string) {
  const query = useQuery(performanceRunQueryOptions(slug, runId));
  useRefreshWhenRunEnds(slug, isPerformanceRunActive(query.data?.effective_status) ? runId : null);
  useRefreshWhenLateResultsArrive(slug, runId, query.data);
  return query;
}

/** `GET B/runs/{id}/questions`, once: a page, or with `after_seq` the rows after the ones the page holds. */
export function fetchPerformanceQuestions(
  slug: string,
  runId: string,
  filters: PerformanceQuestionFilters = {},
) {
  return performanceRead<PerformanceQuestionsPage>(
    performanceApiPath(slug, runSub(runId, '/questions'), cleanFilters(filters)),
  );
}

/** The previous rows stay while other filters load, inside one run only. */
export function performanceQuestionsQueryOptions(
  slug: string,
  runId: string,
  filters: PerformanceQuestionFilters = {},
  { active = false, enabled = true }: PerformanceTailOptions = {},
) {
  const queryKey = performanceKeys.runQuestions(slug, runId, filters);
  return queryOptions({
    queryKey,
    queryFn: () => fetchPerformanceQuestions(slug, runId, queryKey[6]),
    enabled: enabled && Boolean(runId),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === slug && query.queryKey[4] === runId ? previous : undefined,
    refetchInterval: active ? PERFORMANCE_POLL_ACTIVE_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceQuestions(
  slug: string,
  runId: string,
  filters: PerformanceQuestionFilters = {},
  options: PerformanceTailOptions = {},
) {
  return useQuery(performanceQuestionsQueryOptions(slug, runId, filters, options));
}

/** `GET B/runs/{id}/log`, once: the lines after `after_seq`. */
export function fetchPerformanceLog(slug: string, runId: string, filters: PerformanceLogFilters = {}) {
  return performanceRead<PerformanceLogPage>(
    performanceApiPath(slug, runSub(runId, '/log'), cleanFilters(filters)),
  );
}

export function performanceLogQueryOptions(
  slug: string,
  runId: string,
  filters: PerformanceLogFilters = {},
  { active = false, enabled = true }: PerformanceTailOptions = {},
) {
  const queryKey = performanceKeys.runLog(slug, runId, filters);
  return queryOptions({
    queryKey,
    queryFn: () => fetchPerformanceLog(slug, runId, queryKey[6]),
    enabled: enabled && Boolean(runId),
    placeholderData: (previous, query) =>
      query?.queryKey[1] === slug && query.queryKey[4] === runId ? previous : undefined,
    refetchInterval: active ? PERFORMANCE_POLL_ACTIVE_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceLog(
  slug: string,
  runId: string,
  filters: PerformanceLogFilters = {},
  options: PerformanceTailOptions = {},
) {
  return useQuery(performanceLogQueryOptions(slug, runId, filters, options));
}

/** `GET B/runs/{id}/events`: the run's timeline; every 5 s while the run is active. */
export function performanceRunEventsQueryOptions(
  slug: string,
  runId: string,
  { active = false, enabled = true }: PerformanceTailOptions = {},
) {
  return queryOptions({
    queryKey: performanceKeys.runEvents(slug, runId),
    queryFn: () => performanceRead<PerformanceRunEvents>(performanceApiPath(slug, runSub(runId, '/events'))),
    enabled: enabled && Boolean(runId),
    refetchInterval: active ? PERFORMANCE_POLL_ACTIVE_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function usePerformanceRunEvents(slug: string, runId: string, options: PerformanceTailOptions = {}) {
  return useQuery(performanceRunEventsQueryOptions(slug, runId, options));
}

/** `GET B/targets`: read when the page opens and after each write; not polled. */
export function performanceTargetsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: performanceKeys.targets(slug),
    queryFn: () => performanceRead<PerformanceTargetsRead>(performanceApiPath(slug, '/targets')),
  });
}

export function usePerformanceTargets(slug: string) {
  return useQuery(performanceTargetsQueryOptions(slug));
}

/** The base of every write. `settled` is told the input once the write went through or was refused. */
function useAreaWrite<TInput, TResult>(
  slug: string,
  mutationFn: (input: TInput) => Promise<TResult>,
  { forget = false, settled }: { forget?: boolean; settled?: (input: TInput) => void } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    ...(forget ? { gcTime: 0 } : {}),
    onSuccess: async (_result: TResult, input: TInput) => {
      settled?.(input);
      await client.invalidateQueries({ queryKey: performanceKeys.all(slug) });
    },
    onError: (_error: Error, input: TInput) => {
      settled?.(input);
      void client.invalidateQueries({ queryKey: performanceKeys.all(slug) });
    },
  });
}

/**
 * A write of this area. Afterwards the whole area is read again: a write that went through waits for
 * that, a refused one does not (a refusal mostly means the page showed an old picture).
 * `forget` drops what was sent from memory as soon as nothing shows the result.
 */
export function usePerformanceMutation<TInput, TResult>(
  slug: string,
  mutationFn: (input: TInput) => Promise<TResult>,
  { forget = false }: { forget?: boolean } = {},
) {
  return useAreaWrite(slug, mutationFn, { forget });
}

/**
 * A write that carries a token a person typed. The token is held only from the call until the write
 * went through or was refused. What the write keeps and shows as `variables` (also while the calling
 * component stays mounted) is the input with the token text taken out.
 */
export function useTokenWrite<TInput extends object, TResult>(
  slug: string,
  send: (input: TInput) => Promise<TResult>,
  withoutToken: (input: TInput) => TInput,
) {
  const [typed] = useState(() => new WeakMap<TInput, TInput>());
  const write = useAreaWrite(
    slug,
    (kept: TInput) => {
      const input = typed.get(kept);
      // The request owns its input now; no dialog state keeps a copy while it is in flight.
      typed.delete(kept);
      return input ? send(input) : Promise.reject(new Error('The token is no longer held. Enter it again.'));
    },
    { forget: true, settled: (kept) => typed.delete(kept) },
  );
  // The library types its two functions by a condition on the input type, which stays open for a generic
  // input. Both inputs here are objects, so the functions take (input, options): said once, by these casts.
  type Options = MutateOptions<TResult, Error, TInput>;
  const start = write.mutate as unknown as (input: TInput, options?: Options) => void;
  const startAsync = write.mutateAsync as unknown as (input: TInput, options?: Options) => Promise<TResult>;
  const mutate = useCallback(
    (input: TInput, options?: Options) => {
      const kept = withoutToken(input);
      typed.set(kept, input);
      start(kept, options);
    },
    [start, typed, withoutToken],
  );
  const mutateAsync = useCallback(
    (input: TInput, options?: Options) => {
      const kept = withoutToken(input);
      typed.set(kept, input);
      return startAsync(kept, options);
    },
    [startAsync, typed, withoutToken],
  );
  return useMemo(
    () => ({ ...write, mutate, mutateAsync }) as unknown as typeof write,
    [write, mutate, mutateAsync],
  );
}

/** `POST B/runs`. A refusal is a `StartRunError`: read it with `performanceError`. */
export function useStartPerformanceRun(slug: string) {
  return usePerformanceMutation(slug, (body: StartRunRequest) =>
    api.post<StartRunResponse>(performanceApiPath(slug, '/runs'), body),
  );
}

/** `POST B/runs/{id}/stop`; the reason is optional: `mutate()` or `mutate({ reason })`. */
export function useStopPerformanceRun(slug: string, runId: string) {
  return usePerformanceMutation(slug, (body: StopRunRequest | void) =>
    api.post<StopRunResponse>(performanceApiPath(slug, runSub(runId, '/stop')), body ?? {}),
  );
}

const handOffWithoutToken = (body: TokenHandoffRequest): TokenHandoffRequest => ({ ...body, token: '' });

/** `POST B/runs/{id}/tokens`: a new token for a run that waits for one. The token is not kept. */
export function useHandOffPerformanceToken(slug: string, runId: string) {
  return useTokenWrite(
    slug,
    (body: TokenHandoffRequest) =>
      api.post<TokenHandoffResponse>(performanceApiPath(slug, runSub(runId, '/tokens')), body),
    handOffWithoutToken,
  );
}

/** `POST B/targets` without an id, `PUT B/targets/{id}` with one. Answers the saved target. */
export function useSavePerformanceTarget(slug: string) {
  return usePerformanceMutation(slug, ({ id, body }: { id?: string; body: SaveTargetRequest }) =>
    id
      ? api.put<PerformanceTarget>(performanceApiPath(slug, `/targets/${segment(id)}`), body)
      : api.post<PerformanceTarget>(performanceApiPath(slug, '/targets'), body),
  );
}

/** `DELETE B/targets/{id}`: archives the target; its runs stay. */
export function useArchivePerformanceTarget(slug: string) {
  return usePerformanceMutation(slug, (id: string) =>
    api.delete<null>(performanceApiPath(slug, `/targets/${segment(id)}`)),
  );
}

/** `POST B/targets/{id}/restore`: brings an archived target back. A refusal is a `RestoreTargetError`. */
export function useRestorePerformanceTarget(slug: string) {
  return usePerformanceMutation(slug, (id: string) =>
    api.post<PerformanceTarget>(performanceApiPath(slug, `/targets/${segment(id)}/restore`)),
  );
}

const tokenSub = (targetId: string, name: PerformanceTokenName) =>
  `/targets/${segment(targetId)}/tokens/${segment(name)}`;

interface SaveTargetTokenInput {
  targetId: string;
  name: PerformanceTokenName;
  body: SaveTargetTokenRequest;
}

const targetTokenWithoutToken = (input: SaveTargetTokenInput): SaveTargetTokenInput => ({
  ...input,
  body: { ...input.body, token: '' },
});

/** `PUT B/targets/{id}/tokens/{name}`: save or replace one token. The token is not kept. */
export function useSavePerformanceTargetToken(slug: string) {
  return useTokenWrite(
    slug,
    (input: SaveTargetTokenInput) =>
      api.put<PerformanceTokenHint>(
        performanceApiPath(slug, tokenSub(input.targetId, input.name)),
        input.body,
      ),
    targetTokenWithoutToken,
  );
}

/** `DELETE B/targets/{id}/tokens/{name}`. */
export function useDeletePerformanceTargetToken(slug: string) {
  return usePerformanceMutation(slug, (input: { targetId: string; name: PerformanceTokenName }) =>
    api.delete<null>(performanceApiPath(slug, tokenSub(input.targetId, input.name))),
  );
}

/** `GET B/runs/{id}/questions.csv` with the same filters; the page and the live tail are not part of a file. */
export function performanceQuestionsCsvUrl(
  slug: string,
  runId: string,
  filters: PerformanceQuestionFilters = {},
): string {
  const { after_seq: _after, page: _page, page_size: _size, ...rest } = filters;
  return platformUrl(performanceApiPath(slug, runSub(runId, '/questions.csv'), cleanFilters(rest)));
}

/** `GET B/runs/{id}/log.txt`: the whole log as a file. */
export function performanceLogTextUrl(slug: string, runId: string): string {
  return platformUrl(performanceApiPath(slug, runSub(runId, '/log.txt')));
}

/**
 * The address for a link from a path the API gave (`report.url`): the API's paths come without the
 * platform's root prefix, and a link without it misses the platform behind a proxy.
 */
export function performanceDownloadUrl(path: string): string {
  return /^https?:/.test(path) ? path : platformUrl(path);
}

/** `GET B/runs/{id}/report`, built from the route: the same address as `performanceDownloadUrl(report.url)`. */
export function performanceReportUrl(slug: string, runId: string): string {
  return platformUrl(performanceApiPath(slug, runSub(runId, '/report')));
}
