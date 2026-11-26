/**
 * Sample data for the Performance area: the gallery mocks (PerformanceMocks.tsx) and the page tests read it.
 * Typed with the page contract (`@/api/performance`). The run is the simulated one of the chosen design pages
 * (performanceFixtureData.ts); targets, datasets and people are samples. Hosts end in example.org on purpose:
 * nothing here can reach a real system.
 */
import type {
  PerformanceActiveRun,
  PerformanceCheckTone,
  PerformanceDatasetTiers,
  PerformanceEvent,
  PerformanceHome,
  PerformanceLogPage,
  PerformanceMix,
  PerformancePlan,
  PerformancePlanCheck,
  PerformancePlanInput,
  PerformanceProgress,
  PerformanceQuestionsPage,
  PerformanceReportMeta,
  PerformanceRunConfig,
  PerformanceRunEvents,
  PerformanceRunRead,
  PerformanceRunRow,
  PerformanceRunnerEvents,
  PerformanceRunnerRead,
  PerformanceRunnerStatus,
  PerformanceSetup,
  PerformanceSummary,
  PerformanceTarget,
  PerformanceTargetSummary,
  PerformanceTier,
  PerformanceTokenHint,
} from '@/api/performance';
import {
  performanceAvoidWords,
  performanceCountersRunning,
  performanceCountersStopping,
  performanceCountersTokenNeeded,
  performanceErrorsRunning,
  performanceErrorsTokenNeeded,
  performanceEventsFinal,
  performanceEventsRunning,
  performanceLevelsFinal,
  performanceLevelsRunning,
  performanceLevelsStopped,
  performanceLevelsStopping,
  performanceLevelsTokenNeeded,
  performanceLogLines,
  performanceLogTotal,
  performancePlanStages,
  performanceQuestionRows,
  performanceQuestionsLastSeq,
  performanceSampleQuestions,
} from './performanceFixtureData';

export * from './performanceFixtureData';

/** The project the mocks sit in. */
export const performanceProject = { slug: 'demo', name: 'Demo', id: 'proj_demo_1f9c' };
/** The two people of the sample data. */
export const performancePeople = [
  { id: 'user-ali', name: 'Ali' },
  { id: 'user-faisal', name: 'Faisal' },
];

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** The person ids of the fixture people ('Ali' -> 'user-ali'), as the reads send them beside the names. */
const personId = (name: string) => `user-${name.toLowerCase()}`;

const hint = (
  name: PerformanceTokenHint['name'],
  last4: string,
  version: number,
  updated_at: string,
  updated_by: string,
): PerformanceTokenHint => ({
  name,
  hint: last4,
  version,
  expires_at: null,
  expired: false,
  updated_at,
  updated_by,
  updated_by_user_id: personId(updated_by),
});

const target = (
  t: Pick<PerformanceTarget, 'id' | 'name' | 'base_url' | 'tokens' | 'created_at' | 'last_run'> &
    Partial<PerformanceTarget>,
): PerformanceTarget => ({
  is_production: false,
  chat_path: '/change/api/chat',
  token_refresh_path: '/auth/token',
  max_users: null,
  max_duration_s: null,
  sign_in_ready: t.tokens.some((token) => token.name === 'refresh_token' && !token.expired),
  active_run_id: null,
  can_start: true,
  can_save_tokens: true,
  settings: { auth_server: null, refresh_cookie_name: 'estishraf_rt' },
  archived_at: null,
  created_by: 'Ali',
  created_by_user_id: personId(t.created_by ?? 'Ali'),
  updated_at: t.created_at,
  ...t,
});

/** Four targets that people added: three test environments with a saved sign-in, and production without one. */
export const performanceTargets: PerformanceTarget[] = [
  target({
    id: 'target-playground-17',
    name: 'Playground 17',
    base_url: 'https://insightor.ingress.playground17.example.org',
    tokens: [
      hint('refresh_token', '9f3c', 2, '2026-11-20T10:59:00Z', 'Ali'),
      hint('access_token', 'a71e', 2, '2026-11-20T10:59:00Z', 'Ali'),
    ],
    created_at: '2026-10-11T07:20:00Z',
    last_run: {
      id: 'run-0017',
      number: 17,
      status: 'stopped',
      verdict: 'not_reached',
      finished_at: '2026-11-03T13:12:40Z',
    },
  }),
  target({
    id: 'target-playground-24',
    name: 'Playground 24',
    base_url: 'https://insightor.ingress.playground24.example.org',
    tokens: [
      hint('refresh_token', 'c05a', 1, '2026-11-19T13:20:00Z', 'Faisal'),
      hint('access_token', '77d1', 1, '2026-11-19T13:20:00Z', 'Faisal'),
    ],
    created_by: 'Faisal',
    created_at: '2026-10-11T07:24:00Z',
    last_run: {
      id: 'run-0015',
      number: 15,
      status: 'finished',
      verdict: 'breakpoint_found',
      finished_at: '2026-10-20T10:46:44Z',
    },
  }),
  target({
    id: 'target-preprod',
    name: 'Preprod',
    base_url: 'https://insightor.ingress.preprod.example.org',
    tokens: [
      hint('refresh_token', '41bd', 3, '2026-11-20T10:48:00Z', 'Ali'),
      hint('access_token', '0c2e', 3, '2026-11-20T10:48:00Z', 'Ali'),
    ],
    created_at: '2026-10-11T07:31:00Z',
    last_run: {
      id: 'run-0023',
      number: 23,
      status: 'finished',
      verdict: 'pass',
      finished_at: '2026-11-20T10:54:04Z',
    },
  }),
  target({
    id: 'target-production',
    name: 'Production',
    is_production: true,
    base_url: 'https://insightor.example.org',
    max_users: 60,
    tokens: [],
    created_at: '2026-11-02T09:05:00Z',
    last_run: null,
  }),
];

const [playground17, playground24, preprod, production] = performanceTargets as [
  PerformanceTarget,
  PerformanceTarget,
  PerformanceTarget,
  PerformanceTarget,
];

/** The host of a target's address, for display. */
export const performanceHost = (t: Pick<PerformanceTarget, 'base_url'>) =>
  t.base_url.replace(/^https?:\/\//, '');

export const performanceTargetSummaries: PerformanceTargetSummary[] = performanceTargets.map((t) => ({
  id: t.id,
  name: t.name,
  is_production: t.is_production,
  host: performanceHost(t),
  sign_in_ready: t.sign_in_ready,
  active_run_id: null,
  archived: false,
}));

// ---------------------------------------------------------------------------------------------
// Datasets (the New run page reads them from the Datasets API; the kinds come from `dataset-tiers`)
// ---------------------------------------------------------------------------------------------

export interface PerformanceDatasetSample {
  id: string;
  name: string;
  status: 'published' | 'draft';
  updated_at: string;
  updated_by: string;
  note: string;
  tiers: PerformanceDatasetTiers;
}

const dataset = (
  id: string,
  name: string,
  version: string,
  status: 'published' | 'draft',
  counts: [number, number, number],
  follow_ups: number,
  updated_at: string,
  updated_by: string,
  note: string,
): PerformanceDatasetSample => ({
  id,
  name,
  status,
  updated_at,
  updated_by,
  note,
  tiers: {
    dataset_id: id,
    dataset_version_id: `${id}-${version}`,
    version,
    published: status === 'published',
    item_count: counts[0] + counts[1] + counts[2],
    tier_counts: { simple: counts[0], medium: counts[1], complex: counts[2] },
    untiered: 0,
    single_kind: false,
    follow_ups,
    usable: status === 'published',
    reason:
      status === 'published'
        ? null
        : 'This version is a draft. Publish it in Datasets before a run can use it.',
  },
});

export const performanceDatasets: PerformanceDatasetSample[] = [
  dataset(
    'ds-load',
    'Insightor load questions',
    'v3',
    'published',
    [30, 38, 71],
    133,
    '2026-11-12T08:10:00Z',
    'Ali',
    'The full question bank used by the load tests.',
  ),
  dataset(
    'ds-viz',
    'Charts, maps and reports',
    'v1',
    'published',
    [0, 0, 15],
    15,
    '2026-10-28T09:40:00Z',
    'Ali',
    'Only questions that make Insightor draw something.',
  ),
  dataset(
    'ds-customs',
    'Customs questions',
    'v2',
    'published',
    [5, 5, 5],
    15,
    '2026-10-20T11:00:00Z',
    'Faisal',
    'Questions on the customs tables.',
  ),
  dataset(
    'ds-health',
    'Health check set',
    'v1',
    'published',
    [8, 4, 0],
    6,
    '2026-09-29T07:30:00Z',
    'Ali',
    'Short, fast questions for the 3-minute check.',
  ),
  dataset(
    'ds-load-draft',
    'Insightor load questions',
    'v4',
    'draft',
    [34, 42, 76],
    146,
    '2026-11-19T12:15:00Z',
    'Ali',
    'Draft: publish it in Datasets before a run can use it.',
  ),
];

const [dsLoad, dsViz, , dsHealth] = performanceDatasets as [
  PerformanceDatasetSample,
  PerformanceDatasetSample,
  PerformanceDatasetSample,
  PerformanceDatasetSample,
];

/** The five sample questions the Questions step shows for the usual mix. */
export const performanceStepQuestions = [0, 1, 4, 5, 6].map((index) => performanceSampleQuestions[index]!);

/** The Fields step of the upload dialog: what was read from a sample file and how its fields were guessed. */
export const performanceUploadSample = {
  file_name: 'questions.json',
  format: 'JSON',
  structure: '24 records in 3 named lists (simple, medium, complex)',
  fields: [
    'id',
    'question',
    'description',
    'mustNotContain',
    'followUpQuestions[0].question',
    'followUpQuestions[0].mustNotContain',
  ],
  roles: [
    {
      key: 'question',
      label: 'Question',
      hint: 'Needed',
      field: 'question',
      example: performanceSampleQuestions[0]!.question,
    },
    {
      key: 'kind',
      label: 'Kind',
      hint: 'Simple, medium or complex',
      field: '(the list it sits in)',
      example: 'The list each question sits in: simple, medium, complex',
    },
    {
      key: 'follow_up',
      label: 'Follow-up question',
      hint: 'Asked next in the same conversation',
      field: 'followUpQuestions[0].question',
      example: performanceSampleQuestions[0]!.follow_up ?? '',
    },
    {
      key: 'avoid',
      label: 'Words to avoid',
      hint: 'A good answer does not contain them',
      field: 'mustNotContain',
      example: performanceAvoidWords.join(', '),
    },
    {
      key: 'id',
      label: 'Id',
      hint: 'Shown in the questions table and the log',
      field: 'id',
      example: 'simple_demographics_1',
    },
  ],
  kind_source: 'list name',
  kind_values: [
    { value: 'simple', records: 7, kind: 'simple' },
    { value: 'medium', records: 7, kind: 'medium' },
    { value: 'complex', records: 10, kind: 'complex' },
  ] as { value: string; records: number; kind: PerformanceTier | 'leave_out' }[],
  kept_as_details: ['description', 'followUpQuestions[0].mustNotContain'],
  result: {
    questions: 24,
    tier_counts: { simple: 7, medium: 7, complex: 10 } as Record<PerformanceTier, number>,
    follow_ups: 19,
    with_avoid_words: 24,
    left_out: 0,
  },
  preview: performanceSampleQuestions.slice(0, 4),
};

// ---------------------------------------------------------------------------------------------
// The plan of the sample run
// ---------------------------------------------------------------------------------------------

export const performanceMix: PerformanceMix = { simple: 50, medium: 35, complex: 15 };

const breakpointInput: PerformancePlanInput = {
  baseline_users: 5,
  max_users: 60,
  step_users: 10,
  hold_seconds: 450,
  follow_up_rate: 0.3,
  abort_on_break: true,
  limit_ms: 180_000,
  max_error_rate_pct: 10,
  timeout_seconds: 540,
  users: null,
  duration_seconds: null,
  min_quality: null,
  max_no_data_pct: null,
};
const smokeInput: PerformancePlanInput = {
  baseline_users: null,
  max_users: null,
  step_users: null,
  hold_seconds: null,
  follow_up_rate: null,
  abort_on_break: null,
  limit_ms: 180_000,
  max_error_rate_pct: 10,
  timeout_seconds: 540,
  users: 1,
  duration_seconds: 180,
  min_quality: 80,
  max_no_data_pct: 20,
};
const soakInput: PerformancePlanInput = { ...smokeInput, users: 20, duration_seconds: 7200 };

/** Breakpoint: 10 to 60 users in steps of 10, each held 7m 30s; 50 minutes in all. */
export const performancePlan: PerformancePlan = {
  ...breakpointInput,
  levels: [10, 20, 30, 40, 50, 60],
  total_seconds: 3000,
  warmup_seconds: 30,
  stages: performancePlanStages,
};
/** Smoke: 1 user for 3 minutes. */
export const performanceSmokePlan: PerformancePlan = {
  ...smokeInput,
  levels: [1],
  total_seconds: 180,
  warmup_seconds: 0,
  stages: [{ role: 'steady', target_users: 1, start_s: 0, end_s: 180 }],
};

export const performancePlanChecks: PerformancePlanCheck[] = [
  { code: 'hold_ok', tone: 'ok', message: 'Each level is held 7m 30s, long enough to measure a 180s limit.' },
];

/** The checks the Review step lists: the plan's own, then what the page adds (sign-in, production, dataset). */
export const performanceReviewChecks: { tone: PerformanceCheckTone; message: string }[] = [
  ...performancePlanChecks.map(({ tone, message }) => ({ tone, message })),
];
export const performanceReviewChecksProduction: { tone: PerformanceCheckTone; message: string }[] = [
  {
    tone: 'warn',
    message: 'This puts real load on production. You will be asked to type the name of the target.',
  },
  ...performanceReviewChecks,
];

/** What the Review step and the Start dialog say about the plan. */
export const performancePlanFacts = {
  levels: '10, 20, 30, 40, 50, 60 users',
  load: '10 to 60 users in steps of 10, each held 7m 30s',
  length_seconds: 3000,
  starts_at: '2026-11-20T11:02:00Z',
  ends_at: '2026-11-20T11:52:00Z',
  expected_answers: 1700,
};

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

export const performanceRunnerConnected: PerformanceRunnerStatus = {
  id: 'runner-1',
  key: 'performance-runner-1',
  name: 'performance-runner-1',
  info: {
    runner_version: '0.1.0',
    k6_version: '1.4.2',
    suite_commit: 'd0688f8',
    node_version: '20.18.0',
    host: 'performance-runner-7c9f5',
    location: 'Preprod cluster',
  },
  reported_state: 'idle',
  current_run_id: null,
  last_heartbeat_at: '2026-11-20T11:23:22Z',
  seconds_since_heartbeat: 8,
  fresh: true,
  stale: false,
  runner_key_set: true,
  runner_key_matches: true,
  errors_last_hour: 0,
  registered_at: '2026-11-18T06:02:11Z',
};
export const performanceRunnerBusy: PerformanceRunnerStatus = {
  ...performanceRunnerConnected,
  reported_state: 'running',
  current_run_id: 'run-0024',
  seconds_since_heartbeat: 3,
  last_heartbeat_at: '2026-11-20T11:23:27Z',
};
/** Silent for 6m 12s while it was running run 24: past the 120 s that ends a run. */
export const performanceRunnerSilent: PerformanceRunnerStatus = {
  ...performanceRunnerBusy,
  last_heartbeat_at: '2026-11-20T11:23:30Z',
  seconds_since_heartbeat: 372,
  fresh: false,
  stale: true,
  errors_last_hour: 2,
};

// ---------------------------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------------------------

type RowSeed = Pick<
  PerformanceRunRow,
  'number' | 'test_type' | 'verdict' | 'requested_by' | 'started_at' | 'duration_s'
> &
  Partial<PerformanceRunRow>;

const row = (seed: RowSeed, t: PerformanceTarget, ds: PerformanceDatasetSample): PerformanceRunRow => {
  const started = Date.parse(seed.started_at!);
  return {
    id: `run-${String(seed.number).padStart(4, '0')}`,
    status: 'finished',
    target: { id: t.id, name: t.name, is_production: t.is_production },
    dataset: { id: ds.id, name: ds.name, version: ds.tiers.version },
    requested_by_user_id: seed.requested_by === 'Faisal' ? 'user-faisal' : 'user-ali',
    requested_at: new Date(started - 8000).toISOString(),
    finished_at: seed.duration_s === null ? null : new Date(started + seed.duration_s * 1000).toISOString(),
    safe_load_users: null,
    breaking_level_users: null,
    breaking_reason: null,
    recommended_max_users: null,
    p95_at_safe_load_ms: null,
    p95_ms: null,
    limit_ms: 180_000,
    answers_measured: null,
    answers_total: null,
    errors_total: null,
    error_rate_pct: null,
    max_users: null,
    quality_mean: null,
    status_reason: null,
    note: '',
    has_report: true,
    ...seed,
  };
};

const found = (
  number: number,
  started_at: string,
  duration_s: number,
  requested_by: string,
  safe: number,
  p95_at_safe_load_ms: number,
  answers_total: number,
  error_rate_pct: number,
  breaking_reason: PerformanceRunRow['breaking_reason'] = 'latency',
): RowSeed => ({
  number,
  test_type: 'breakpoint',
  verdict: 'breakpoint_found',
  requested_by,
  started_at,
  duration_s,
  safe_load_users: safe,
  breaking_level_users: safe + 10,
  breaking_reason,
  recommended_max_users: Math.floor(safe * 0.8),
  p95_at_safe_load_ms,
  p95_ms: Math.round(p95_at_safe_load_ms * 0.92),
  answers_measured: Math.round(answers_total * 0.9),
  answers_total,
  errors_total: Math.round((answers_total * error_rate_pct) / 100),
  error_rate_pct,
  max_users: safe + 10,
  quality_mean: 98.9,
});

/** Runs 23 to 13, newest first: what the history table shows under the run in progress. */
export const performancePastRuns: PerformanceRunRow[] = [
  row(
    {
      number: 23,
      test_type: 'smoke',
      verdict: 'pass',
      requested_by: 'Ali',
      started_at: '2026-11-20T10:51:00Z',
      duration_s: 184,
      p95_ms: 41_200,
      answers_measured: 4,
      answers_total: 4,
      errors_total: 0,
      error_rate_pct: 0,
      max_users: 1,
      quality_mean: 100,
    },
    preprod,
    dsHealth,
  ),
  row(found(22, '2026-11-18T07:12:00Z', 2382, 'Ali', 40, 158_400, 1094, 0.6), preprod, dsLoad),
  row(found(21, '2026-11-12T12:40:00Z', 1912, 'Faisal', 30, 141_900, 742, 0.9), preprod, dsLoad),
  row(
    {
      number: 20,
      test_type: 'breakpoint',
      verdict: 'invalid_auth',
      requested_by: 'Faisal',
      started_at: '2026-11-12T08:05:00Z',
      duration_s: 1106,
      answers_total: 301,
      errors_total: 86,
      error_rate_pct: 28.7,
      max_users: 30,
      status_reason: 'Not valid: the sign-in ran out during level 30 and nobody sent a new token.',
    },
    preprod,
    dsLoad,
  ),
  row(
    {
      number: 19,
      test_type: 'soak',
      verdict: 'pass',
      requested_by: 'Ali',
      started_at: '2026-11-09T06:30:00Z',
      duration_s: 7200,
      p95_ms: 96_300,
      answers_measured: 3120,
      answers_total: 3120,
      errors_total: 6,
      error_rate_pct: 0.2,
      max_users: 20,
      quality_mean: 99.1,
    },
    preprod,
    dsLoad,
  ),
  row(found(18, '2026-11-05T11:20:00Z', 2390, 'Ali', 40, 161_200, 1101, 0.4), preprod, dsLoad),
  row(
    {
      number: 17,
      test_type: 'breakpoint',
      status: 'stopped',
      verdict: 'not_reached',
      requested_by: 'Ali',
      started_at: '2026-11-03T13:02:00Z',
      duration_s: 640,
      safe_load_users: 10,
      recommended_max_users: 8,
      p95_at_safe_load_ms: 88_300,
      p95_ms: 84_100,
      answers_measured: 88,
      answers_total: 96,
      errors_total: 0,
      error_rate_pct: 0,
      max_users: 20,
      quality_mean: 99.4,
      status_reason: 'Stopped by Ali after 10m 40s. Level 20 was not finished.',
    },
    playground17,
    dsViz,
  ),
  row(found(16, '2026-10-28T07:45:00Z', 2388, 'Ali', 40, 149_800, 1077, 2.8, 'errors'), preprod, dsLoad),
  row(found(15, '2026-10-20T10:15:00Z', 1904, 'Ali', 30, 152_300, 731, 0.7), playground24, dsLoad),
  row(found(14, '2026-10-12T06:50:00Z', 1898, 'Ali', 30, 166_700, 718, 1.0), playground24, dsLoad),
  row(
    {
      number: 13,
      test_type: 'smoke',
      verdict: 'fail',
      requested_by: 'Ali',
      started_at: '2026-10-12T06:41:00Z',
      duration_s: 181,
      p95_ms: 133_600,
      limit_ms: 120_000,
      answers_measured: 3,
      answers_total: 3,
      errors_total: 0,
      error_rate_pct: 0,
      max_users: 1,
      quality_mean: 100,
    },
    playground17,
    dsHealth,
  ),
];

/** Run 24 while it runs: second 1290 of 3000, level 30 of 60. */
export const performanceRunRowRunning: PerformanceRunRow = row(
  {
    number: 24,
    test_type: 'breakpoint',
    status: 'running',
    verdict: null,
    requested_by: 'Ali',
    started_at: '2026-11-20T11:02:00Z',
    duration_s: 1290,
    finished_at: null,
    p95_ms: performanceCountersRunning.p95_ms,
    answers_total: performanceCountersRunning.finished,
    errors_total: performanceCountersRunning.errors,
    error_rate_pct: 0.4,
    max_users: 60,
    has_report: false,
  },
  preprod,
  dsLoad,
);

/** Run 24 as it ended: it broke at 50 users and stopped by itself after 39m 59s. */
export const performanceRunRowBreakFound: PerformanceRunRow = row(
  {
    number: 24,
    test_type: 'breakpoint',
    verdict: 'breakpoint_found',
    requested_by: 'Ali',
    started_at: '2026-11-20T11:02:00Z',
    duration_s: 2399,
    safe_load_users: 40,
    breaking_level_users: 50,
    breaking_reason: 'latency',
    recommended_max_users: 32,
    p95_at_safe_load_ms: 147_628,
    p95_ms: 136_309,
    answers_measured: 913,
    answers_total: 1008,
    errors_total: 8,
    error_rate_pct: 0.8,
    max_users: 50,
    quality_mean: 98.9,
  },
  preprod,
  dsLoad,
);

export const performanceActiveRun: PerformanceActiveRun = {
  id: 'run-0024',
  number: 24,
  test_type: 'breakpoint',
  status: 'running',
  target: performanceRunRowRunning.target,
  requested_by: 'Ali',
  requested_by_user_id: 'user-ali',
  requested_at: performanceRunRowRunning.requested_at,
  started_at: '2026-11-20T11:02:00Z',
  elapsed_s: 1290,
  planned_s: 3000,
  phase: 'hold',
  level: 30,
  users: 30,
  answers_finished: performanceCountersRunning.finished,
  answers_in_flight: performanceCountersRunning.in_flight,
  errors: performanceCountersRunning.errors,
  p95_ms: performanceCountersRunning.p95_ms,
  limit_ms: 180_000,
  stop_requested: false,
  token_needed: null,
  seconds_since_report: 3,
  // The same plan and the same levels as the run page's own read of this run (performanceRunRunning).
  stages: performancePlanStages,
  levels: performanceLevelsRunning,
};

const trend = performancePastRuns
  .filter((run) => run.verdict === 'breakpoint_found')
  .map((run) => ({
    run_id: run.id,
    number: run.number,
    target_id: run.target.id,
    finished_at: run.finished_at!,
    safe_load_users: run.safe_load_users!,
    breaking_level_users: run.breaking_level_users,
    max_users: run.max_users,
  }))
  .reverse();

const page = (rows: PerformanceRunRow[]) => ({ rows, total: rows.length, page: 1, page_size: 25 });

/** Home while run 24 runs. */
export const performanceHomeRunning: PerformanceHome = {
  server_time: '2026-11-20T11:23:30Z',
  runner: performanceRunnerBusy,
  active_run: performanceActiveRun,
  targets: performanceTargetSummaries.map((t) =>
    t.id === preprod.id ? { ...t, active_run_id: 'run-0024' } : t,
  ),
  runs: page([performanceRunRowRunning, ...performancePastRuns]),
  safe_load_trend: trend,
  can: { start: true, manage: true },
};
/** Home with nothing running: the latest capacity result and the history. */
export const performanceHomeIdle: PerformanceHome = {
  ...performanceHomeRunning,
  server_time: '2026-11-20T11:00:30Z',
  runner: performanceRunnerConnected,
  active_run: null,
  targets: performanceTargetSummaries,
  runs: page(performancePastRuns),
};
/** Home when the runner went silent 6 minutes ago: the history stays, a run cannot start. */
export const performanceHomeOffline: PerformanceHome = {
  ...performanceHomeIdle,
  runner: { ...performanceRunnerSilent, reported_state: 'idle', current_run_id: null },
};
/** A project where no runner ever connected and nothing was run. */
export const performanceHomeNoRunner: PerformanceHome = {
  ...performanceHomeIdle,
  runner: null,
  targets: [],
  runs: page([]),
  safe_load_trend: [],
};
/** A runner is connected and targets exist, but no run was started yet. */
export const performanceHomeFirstRun: PerformanceHome = {
  ...performanceHomeIdle,
  runs: page([]),
  safe_load_trend: [],
};

// ---------------------------------------------------------------------------------------------
// New run: setup data
// ---------------------------------------------------------------------------------------------

export const performanceSetup: PerformanceSetup = {
  server_time: '2026-11-20T11:01:30Z',
  runner: performanceRunnerConnected,
  targets: performanceTargets,
  can_manage_targets: true,
  limits: {
    baseline_users: [1, 50],
    max_users: [10, 200],
    step_users: [5, 50],
    hold_seconds: [60, 900],
    limit_ms: [30_000, 600_000],
    max_error_rate_pct: [1, 50],
    follow_up_rate: [0, 1],
    timeout_seconds: [30, 900],
    users: [1, 100],
    duration_seconds: [1800, 28_800],
    max_total_seconds: 28_800,
    starts_per_hour: 20,
    starts_left: 19,
  },
  defaults: {
    breakpoint: { plan: breakpointInput, mix: performanceMix },
    smoke: { plan: smokeInput, mix: { simple: 70, medium: 30, complex: 0 } },
    soak: { plan: soakInput, mix: performanceMix },
  },
  encryption_ready: true,
  store_answers_default: { production: false, other: true },
  blocked: null,
};

// ---------------------------------------------------------------------------------------------
// The run page
// ---------------------------------------------------------------------------------------------

export const performanceRunConfig: PerformanceRunConfig = {
  schema: 1,
  test_type: 'breakpoint',
  target: {
    id: preprod.id,
    name: preprod.name,
    is_production: false,
    base_url: preprod.base_url,
    chat_path: preprod.chat_path,
    auth_server: null,
    token_refresh_path: preprod.token_refresh_path,
    refresh_cookie_name: 'estishraf_rt',
  },
  tokens: preprod.tokens.map(({ name, hint: last4, version }) => ({ name, hint: last4, version })),
  plan: performancePlan,
  mix: performanceMix,
  dataset: {
    id: dsLoad.id,
    name: dsLoad.name,
    version_id: dsLoad.tiers.dataset_version_id,
    version: 'v3',
    item_count: 139,
    content_hash: 'sha256:5b1f0c7ad2e94f3381c6a09d47e2b85f',
    tier_counts: dsLoad.tiers.tier_counts,
    single_kind: false,
  },
  options: { store_answers: true, question_sent_lines: true },
  note: '',
};

const runningAnswers = {
  sent: performanceCountersRunning.finished + performanceCountersRunning.in_flight,
  finished: performanceCountersRunning.finished,
  ok: performanceCountersRunning.ok,
  errors: performanceCountersRunning.errors,
  interrupted: 0,
  in_flight: performanceCountersRunning.in_flight,
  oldest_in_flight_s: performanceCountersRunning.oldest_in_flight_s,
  follow_ups: performanceCountersRunning.follow_ups,
  warmup: performanceCountersRunning.warmup,
};

/** The runner's report at second 1290: level 30 of 60 is being measured. */
export const performanceProgressRunning: PerformanceProgress = {
  phase: 'hold',
  step: null,
  elapsed_s: 1290,
  planned_s: 3000,
  stage: { role: 'hold', target_users: 30, start_s: 1050, end_s: 1500, index: 7, of: 15 },
  level: 30,
  users: 30,
  users_max: 60,
  answers: runningAnswers,
  errors_by_kind: performanceErrorsRunning,
  p95_ms: performanceCountersRunning.p95_ms,
  ttfb_p95_ms: performanceCountersRunning.ttfb_p95_ms,
  quality_mean: performanceCountersRunning.quality_mean,
  no_data_pct: performanceCountersRunning.no_data_pct,
  levels: performanceLevelsRunning,
  auth: {
    state: 'ok',
    token_versions: { refresh_token: 3, access_token: 3 },
    refresh_ok: 14,
    refresh_failed: 0,
    users_rejected: 0,
    users_recovered: 0,
    rejected_at: null,
    recovered_at: null,
  },
  waiting_for_token: null,
  dropped: { questions: 0, log_lines: 0 },
};

const runBase = {
  stored_status: 'running' as const,
  claimed_at: '2026-11-20T11:01:56Z',
  last_report_at: '2026-11-20T11:23:27Z',
  stop_requested_at: null,
  stop_requested_by: null,
  stop_requested_by_user_id: null,
  stop_reason: null,
  error: null,
  exit_code: null,
};

/** Run 24, 21m 30s in. */
export const performanceRunRunning: PerformanceRunRead = {
  server_time: '2026-11-20T11:23:30Z',
  run: { ...performanceRunRowRunning, ...runBase },
  effective_status: 'running',
  status_reason: null,
  config: performanceRunConfig,
  progress: performanceProgressRunning,
  seconds_since_report: 3,
  runner: {
    name: 'performance-runner-1',
    reported_state: 'running',
    seconds_since_heartbeat: 3,
    fresh: true,
    stale: false,
  },
  stop_requested: false,
  token_needed: null,
  tokens: preprod.tokens,
  summary: null,
  report: null,
  report_expired: false,
  counts: {
    questions_received: performanceCountersRunning.finished,
    questions_dropped: 0,
    log_lines_received: performanceLogTotal,
    log_lines_dropped: 0,
    events: performanceEventsRunning.length,
  },
  late_results_until: null,
  can: { stop: true, hand_off_token: true },
};

/** Run 24 a few seconds after Start: the runner has not picked it up yet. */
export const performanceRunQueued: PerformanceRunRead = {
  ...performanceRunRunning,
  server_time: '2026-11-20T11:01:58Z',
  run: {
    ...performanceRunRowRunning,
    ...runBase,
    status: 'queued',
    stored_status: 'queued',
    started_at: null,
    duration_s: null,
    p95_ms: null,
    answers_total: null,
    errors_total: null,
    error_rate_pct: null,
    claimed_at: null,
    last_report_at: null,
  },
  effective_status: 'queued',
  progress: null,
  seconds_since_report: null,
  runner: {
    name: 'performance-runner-1',
    reported_state: 'idle',
    seconds_since_heartbeat: 4,
    fresh: true,
    stale: false,
  },
  counts: {
    questions_received: 0,
    questions_dropped: 0,
    log_lines_received: 0,
    log_lines_dropped: 0,
    events: 1,
  },
};

/** Run 24 when its refresh token was rejected at 14:23:02: the runner waits for a new one. */
export const performanceRunTokenNeeded: PerformanceRunRead = {
  ...performanceRunRunning,
  server_time: '2026-11-20T11:23:40Z',
  run: {
    ...performanceRunRunning.run,
    duration_s: 1300,
    errors_total: performanceCountersTokenNeeded.errors,
    error_rate_pct: 2,
  },
  progress: {
    ...performanceProgressRunning,
    elapsed_s: 1300,
    answers: {
      ...runningAnswers,
      sent: performanceCountersTokenNeeded.finished + performanceCountersTokenNeeded.in_flight,
      ok: performanceCountersTokenNeeded.ok,
      errors: performanceCountersTokenNeeded.errors,
      in_flight: performanceCountersTokenNeeded.in_flight,
      oldest_in_flight_s: performanceCountersTokenNeeded.oldest_in_flight_s,
      follow_ups: performanceCountersTokenNeeded.follow_ups,
    },
    errors_by_kind: performanceErrorsTokenNeeded,
    p95_ms: performanceCountersTokenNeeded.p95_ms,
    ttfb_p95_ms: performanceCountersTokenNeeded.ttfb_p95_ms,
    quality_mean: performanceCountersTokenNeeded.quality_mean,
    no_data_pct: performanceCountersTokenNeeded.no_data_pct,
    levels: performanceLevelsTokenNeeded,
    auth: {
      state: 'rejected',
      token_versions: { refresh_token: 3, access_token: 3 },
      refresh_ok: 14,
      refresh_failed: 3,
      users_rejected: 6,
      users_recovered: 0,
      rejected_at: '2026-11-20T11:23:02Z',
      recovered_at: null,
    },
    waiting_for_token: 'refresh_token',
  },
  token_needed: 'refresh_token',
};

/** Run 24 after Ali pressed Stop at 14:26:30: the runner is ending the test. */
export const performanceRunStopping: PerformanceRunRead = {
  ...performanceRunRunning,
  server_time: '2026-11-20T11:26:34Z',
  run: {
    ...performanceRunRunning.run,
    status: 'stopping',
    stored_status: 'stopping',
    duration_s: 1470,
    stop_requested_at: '2026-11-20T11:26:30Z',
    stop_requested_by: 'Ali',
    stop_requested_by_user_id: 'user-ali',
    stop_reason: 'Preprod is needed for a demo.',
  },
  effective_status: 'stopping',
  progress: {
    ...performanceProgressRunning,
    phase: 'stopping',
    elapsed_s: 1470,
    answers: {
      ...runningAnswers,
      sent: performanceCountersStopping.finished + performanceCountersStopping.in_flight,
      finished: performanceCountersStopping.finished,
      ok: performanceCountersStopping.ok,
      errors: performanceCountersStopping.errors,
      in_flight: performanceCountersStopping.in_flight,
      oldest_in_flight_s: performanceCountersStopping.oldest_in_flight_s,
      follow_ups: performanceCountersStopping.follow_ups,
    },
    p95_ms: performanceCountersStopping.p95_ms,
    levels: performanceLevelsStopping,
  },
  stop_requested: true,
  can: { stop: false, hand_off_token: false },
};

const report: PerformanceReportMeta = {
  byte_size: 412_608,
  sha256: '9c41e7a05b3d4f8e96a1c2d07f5b8e3a1d6c4b29e0f7a5381c2d9b6e4f0a7c13',
  received_at: '2026-11-20T11:42:06Z',
  expires_at: '2027-05-19T11:42:06Z',
  url: '/api/projects/demo/performance/runs/run-0024/report',
};

/** The result of run 24. */
export const performanceSummaryBreakFound: PerformanceSummary = {
  schema: 1,
  test_type: 'breakpoint',
  verdict: 'breakpoint_found',
  verdict_reason: 'At 50 users 95% of answers took 196s, over the 180s limit.',
  ended_by: 'auto_stop',
  exit_code: 0,
  started_at: '2026-11-20T11:02:00Z',
  ended_at: '2026-11-20T11:41:59Z',
  target_url: `${preprod.base_url}${preprod.chat_path}`,
  headline: {
    safe_load_users: 40,
    breaking_level_users: 50,
    breaking_reason: 'latency',
    recommended_max_users: 32,
    p95_at_safe_load_ms: 147_628,
    answers_measured: 913,
    duration_s: 2399,
    p95_ms: 136_309,
    answers_total: 1008,
    errors_total: 8,
    error_rate_pct: 0.8,
    ttfb_p95_ms: 48_210,
    max_users: 50,
    quality_mean: 98.9,
  },
  thresholds: [
    {
      scope: 'Level 50',
      metric: 'p95_ms',
      expression: '95% of answers within 180s',
      measured: 196_426,
      ok: false,
    },
    {
      scope: 'Level 50',
      metric: 'error_pct',
      expression: 'Fewer than 10% of answers fail',
      measured: 2.8,
      ok: true,
    },
  ],
  levels: performanceLevelsFinal,
  counts: {
    iterations: 850,
    follow_ups: 158,
    interrupted: 44,
    by_tier: { simple: 502, medium: 333, complex: 173 },
  },
};

/** Run 24 finished: it breaks at 50 users. */
export const performanceRunBreakFound: PerformanceRunRead = {
  ...performanceRunRunning,
  server_time: '2026-11-20T11:44:00Z',
  run: {
    ...performanceRunRowBreakFound,
    ...runBase,
    stored_status: 'finished',
    last_report_at: '2026-11-20T11:42:01Z',
    exit_code: 0,
  },
  effective_status: 'finished',
  progress: {
    ...performanceProgressRunning,
    phase: 'finishing',
    elapsed_s: 2399,
    stage: null,
    level: null,
    users: 0,
    answers: {
      ...runningAnswers,
      sent: 1052,
      finished: 1008,
      ok: 1000,
      errors: 8,
      interrupted: 44,
      in_flight: 0,
      oldest_in_flight_s: null,
      follow_ups: 158,
    },
    errors_by_kind: { auth: 0, rate_limit: 0, server: 5, network: 3, run_failed: 0, other: 0 },
    p95_ms: 136_309,
    levels: performanceLevelsFinal
      .filter((level) => level.has_data)
      // A level with data has these as numbers (guide 4.7); `?? 0` only satisfies the type.
      .map((level) => ({
        level: level.level,
        state: 'done' as const,
        hold_elapsed_pct: level.hold_elapsed_pct ?? 0,
        answers: level.answers ?? 0,
        errors: Math.round(((level.answers ?? 0) * (level.error_pct ?? 0)) / 100),
        error_pct: level.error_pct ?? 0,
        auth_errors: 0,
        interrupted: level.interrupted,
        p50_ms: level.p50_ms,
        p95_ms: level.p95_ms,
        max_ms: level.max_ms,
        ttfb_p95_ms: level.ttfb_p95_ms,
        per_minute: level.per_minute ?? 0,
        quality_mean: level.quality_mean,
        no_data_pct: level.no_data_pct,
        result: level.result,
        reason: level.latency_breach ? ('latency' as const) : null,
      })),
  },
  seconds_since_report: 119,
  runner: {
    name: 'performance-runner-1',
    reported_state: 'idle',
    seconds_since_heartbeat: 6,
    fresh: true,
    stale: false,
  },
  summary: performanceSummaryBreakFound,
  report,
  counts: {
    questions_received: 1008,
    questions_dropped: 0,
    log_lines_received: 1034,
    log_lines_dropped: 0,
    events: 26,
  },
  late_results_until: '2026-11-20T11:51:59Z',
  can: { stop: false, hand_off_token: false },
};

/** Run 24 if Ali had stopped it at 24m 40s: levels 10 to 30 passed, level 30 at 96% of its hold. */
export const performanceRunStopped: PerformanceRunRead = {
  ...performanceRunBreakFound,
  server_time: '2026-11-20T11:28:00Z',
  run: {
    ...performanceRunRowBreakFound,
    ...runBase,
    status: 'stopped',
    stored_status: 'stopped',
    verdict: 'not_reached',
    duration_s: 1480,
    finished_at: '2026-11-20T11:26:40Z',
    safe_load_users: 30,
    breaking_level_users: null,
    breaking_reason: null,
    recommended_max_users: 24,
    p95_at_safe_load_ms: 109_740,
    p95_ms: 92_480,
    answers_measured: 493,
    answers_total: 543,
    errors_total: 3,
    error_rate_pct: 0.6,
    max_users: 30,
    stop_requested_at: '2026-11-20T11:26:30Z',
    stop_requested_by: 'Ali',
    stop_requested_by_user_id: 'user-ali',
    stop_reason: 'Preprod is needed for a demo.',
    status_reason: 'Stopped by Ali after 24m 40s.',
  },
  effective_status: 'stopped',
  status_reason: {
    code: 'stopped_by_person',
    message: 'Stopped by Ali after 24m 40s. The result covers what was measured.',
  },
  summary: {
    ...performanceSummaryBreakFound,
    verdict: 'not_reached',
    verdict_reason: 'No level broke a limit up to 30 users.',
    ended_by: 'stop',
    ended_at: '2026-11-20T11:26:40Z',
    headline: {
      ...performanceSummaryBreakFound.headline,
      safe_load_users: 30,
      breaking_level_users: null,
      breaking_reason: null,
      recommended_max_users: 24,
      p95_at_safe_load_ms: 109_740,
      answers_measured: 493,
      duration_s: 1480,
      p95_ms: 92_480,
      answers_total: 543,
      errors_total: 3,
      error_rate_pct: 0.6,
      max_users: 30,
    },
    thresholds: [
      {
        scope: 'Level 30',
        metric: 'p95_ms',
        expression: '95% of answers within 180s',
        measured: 109_740,
        ok: true,
      },
      {
        scope: 'Level 30',
        metric: 'error_pct',
        expression: 'Fewer than 10% of answers fail',
        measured: 0,
        ok: true,
      },
    ],
    levels: performanceLevelsStopped,
    counts: {
      iterations: 470,
      follow_ups: 81,
      interrupted: 27,
      by_tier: { simple: 262, medium: 189, complex: 92 },
    },
  },
  counts: {
    questions_received: 543,
    questions_dropped: 0,
    log_lines_received: 557,
    log_lines_dropped: 0,
    events: 15,
  },
  late_results_until: '2026-11-20T11:36:40Z',
};

/** Run 24 if the runner had gone silent at 14:23:30: ended after 120 s of silence, with no result. */
export const performanceRunInterrupted: PerformanceRunRead = {
  ...performanceRunRunning,
  server_time: '2026-11-20T11:29:42Z',
  run: {
    ...performanceRunRunning.run,
    status: 'interrupted',
    stored_status: 'running',
    finished_at: '2026-11-20T11:25:30Z',
    status_reason: 'The runner stopped reporting. The run was ended after 120s of silence.',
  },
  effective_status: 'interrupted',
  status_reason: {
    code: 'runner_silent',
    message:
      'The runner stopped reporting at 14:23:30. After 120s of silence the run was ended. It cannot continue.',
  },
  seconds_since_report: 372,
  runner: {
    name: 'performance-runner-1',
    reported_state: 'running',
    seconds_since_heartbeat: 372,
    fresh: false,
    stale: true,
  },
  late_results_until: '2026-11-20T11:35:30Z',
  can: { stop: false, hand_off_token: false },
};

/** A run that never sent load: the runner's check before the start found that the sign-in did not work. */
export const performanceRunFailed: PerformanceRunRead = {
  ...performanceRunQueued,
  server_time: '2026-11-20T11:03:10Z',
  run: {
    ...performanceRunQueued.run,
    status: 'failed',
    stored_status: 'failed',
    started_at: '2026-11-20T11:02:00Z',
    finished_at: '2026-11-20T11:02:09Z',
    duration_s: 9,
    claimed_at: '2026-11-20T11:01:56Z',
    last_report_at: '2026-11-20T11:02:09Z',
    error: 'Check before the start: the sign-in renewal answered 401 (invalid_grant).',
    exit_code: null,
    status_reason: 'The sign-in did not work when the runner checked it before the start.',
  },
  effective_status: 'failed',
  status_reason: {
    code: 'preflight_failed',
    message:
      'The sign-in did not work when the runner checked it before the start: the refresh token was refused. No load was sent.',
  },
  counts: {
    questions_received: 0,
    questions_dropped: 0,
    log_lines_received: 6,
    log_lines_dropped: 0,
    events: 3,
  },
  can: { stop: false, hand_off_token: false },
};

const smokeRow = performancePastRuns[0]!;

/** Run 23: a Smoke test that passed (1 user for 3 minutes, 4 answers). */
export const performanceRunPassed: PerformanceRunRead = {
  ...performanceRunBreakFound,
  server_time: '2026-11-20T10:56:00Z',
  run: {
    ...smokeRow,
    ...runBase,
    stored_status: 'finished',
    claimed_at: '2026-11-20T10:50:56Z',
    last_report_at: '2026-11-20T10:54:05Z',
    exit_code: 0,
  },
  config: {
    ...performanceRunConfig,
    test_type: 'smoke',
    plan: performanceSmokePlan,
    mix: { simple: 70, medium: 30, complex: 0 },
    dataset: {
      id: dsHealth.id,
      name: dsHealth.name,
      version_id: dsHealth.tiers.dataset_version_id,
      version: 'v1',
      item_count: 12,
      content_hash: 'sha256:0d7c4e19a2b65f8833f1c9a4e7b20d6c',
      tier_counts: dsHealth.tiers.tier_counts,
      single_kind: false,
    },
  },
  progress: {
    ...performanceProgressRunning,
    phase: 'finishing',
    elapsed_s: 184,
    planned_s: 180,
    stage: null,
    level: null,
    users: 0,
    users_max: 1,
    answers: {
      sent: 4,
      finished: 4,
      ok: 4,
      errors: 0,
      interrupted: 0,
      in_flight: 0,
      oldest_in_flight_s: null,
      follow_ups: 1,
      warmup: 0,
    },
    errors_by_kind: { auth: 0, rate_limit: 0, server: 0, network: 0, run_failed: 0, other: 0 },
    p95_ms: 41_200,
    ttfb_p95_ms: 14_900,
    quality_mean: 100,
    no_data_pct: 0,
    levels: [],
  },
  summary: {
    schema: 1,
    test_type: 'smoke',
    verdict: 'pass',
    verdict_reason: 'Every limit was kept.',
    ended_by: 'plan',
    exit_code: 0,
    started_at: '2026-11-20T10:51:00Z',
    ended_at: '2026-11-20T10:54:04Z',
    target_url: `${preprod.base_url}${preprod.chat_path}`,
    headline: {
      safe_load_users: null,
      breaking_level_users: null,
      breaking_reason: null,
      recommended_max_users: null,
      p95_at_safe_load_ms: null,
      answers_measured: 4,
      duration_s: 184,
      p95_ms: 41_200,
      answers_total: 4,
      errors_total: 0,
      error_rate_pct: 0,
      ttfb_p95_ms: 14_900,
      max_users: 1,
      quality_mean: 100,
    },
    thresholds: [
      {
        scope: 'Whole run',
        metric: 'p95_ms',
        expression: '95% of answers within 180s',
        measured: 41_200,
        ok: true,
      },
      {
        scope: 'Whole run',
        metric: 'error_pct',
        expression: 'Fewer than 10% of answers fail',
        measured: 0,
        ok: true,
      },
      {
        scope: 'Whole run',
        metric: 'quality_mean',
        expression: 'Average quality of at least 80',
        measured: 100,
        ok: true,
      },
      {
        scope: 'Whole run',
        metric: 'no_data_pct',
        expression: 'Fewer than 20% of answers say there is no data',
        measured: 0,
        ok: true,
      },
    ],
    levels: [],
    counts: { iterations: 3, follow_ups: 1, interrupted: 0, by_tier: { simple: 3, medium: 1, complex: 0 } },
  },
  report: {
    ...report,
    byte_size: 96_412,
    received_at: '2026-11-20T10:54:10Z',
    url: '/api/projects/demo/performance/runs/run-0023/report',
  },
  counts: {
    questions_received: 4,
    questions_dropped: 0,
    log_lines_received: 18,
    log_lines_dropped: 0,
    events: 4,
  },
  late_results_until: '2026-11-20T11:04:04Z',
};

/** The first page of the Questions tab of the running run. */
export const performanceQuestionsPage: PerformanceQuestionsPage = {
  rows: performanceQuestionRows,
  total: performanceCountersRunning.finished,
  page: 1,
  page_size: 50,
  last_seq: performanceQuestionsLastSeq,
  facets: {
    statuses: { ok: performanceCountersRunning.ok, error: performanceCountersRunning.errors, interrupted: 0 },
    tiers: performanceCountersRunning.tiers,
    levels: performanceCountersRunning.level_counts,
    error_kinds: { server: performanceErrorsRunning.server },
    followups: performanceCountersRunning.follow_ups,
    no_data: performanceCountersRunning.no_data,
  },
};

/** The end of the log of the running run. */
export const performanceLogPage: PerformanceLogPage = {
  lines: performanceLogLines,
  next_after_seq: null,
  last_seq: performanceLogTotal,
  total: performanceLogTotal,
  dropped: 0,
};

export const performanceRunEvents: PerformanceRunEvents = { events: performanceEventsRunning };
export const performanceRunEventsFinal: PerformanceRunEvents = { events: performanceEventsFinal };

// ---------------------------------------------------------------------------------------------
// The Runner page
// ---------------------------------------------------------------------------------------------

const note = (
  id: number,
  at: string,
  level: PerformanceEvent['level'],
  code: string,
  message: string,
  source: PerformanceEvent['source'],
  run_id: string | null = null,
): PerformanceEvent => ({ id, at, level, code, message, details: {}, source, run_id });

const runnerNotes: PerformanceEvent[] = [
  note(
    41,
    '2026-11-20T10:54:10Z',
    'info',
    'run_finished',
    'Run 23 finished and its report was stored.',
    'runner',
    'run-0023',
  ),
  note(40, '2026-11-20T10:50:56Z', 'info', 'run_claimed', 'Run 23 was picked up.', 'runner', 'run-0023'),
  note(
    39,
    '2026-11-18T07:51:42Z',
    'info',
    'run_finished',
    'Run 22 finished and its report was stored.',
    'runner',
    'run-0022',
  ),
  note(38, '2026-11-18T06:02:11Z', 'info', 'registered', 'The runner registered with version 0.1.0.', 'qym'),
  note(
    37,
    '2026-11-18T06:01:40Z',
    'warning',
    'restarted',
    'The runner was restarted. No run was in progress.',
    'runner',
  ),
];

export const performanceRunnerEvents: PerformanceRunnerEvents = {
  events: runnerNotes,
  total: 5,
  page: 1,
  limit: 10,
};
export const performanceRunnerEventsSilent: PerformanceRunnerEvents = {
  events: [
    note(
      44,
      '2026-11-20T11:25:30Z',
      'error',
      'run_interrupted',
      'Run 24 was ended: the runner had not reported for 120s.',
      'qym',
      'run-0024',
    ),
    note(
      43,
      '2026-11-20T11:23:19Z',
      'error',
      'report_failed',
      'A progress report could not be sent: no answer within 10s.',
      'runner',
      'run-0024',
    ),
    note(42, '2026-11-20T11:01:56Z', 'info', 'run_claimed', 'Run 24 was picked up.', 'runner', 'run-0024'),
    ...runnerNotes,
  ],
  total: 8,
  page: 1,
  limit: 10,
};

/** The Runner page with a connected, idle runner. */
export const performanceRunnerRead: PerformanceRunnerRead = {
  server_time: '2026-11-20T11:00:30Z',
  runner: performanceRunnerConnected,
  events_total: performanceRunnerEvents.total,
  runner_key: {
    id: 'key-3',
    name: 'Performance runner',
    prefix: 'qym_7f3a',
    changed_at: '2026-11-18T05:58:00Z',
    changed_by: 'Ali',
    changed_by_user_id: 'user-ali',
  },
  api_keys: [
    { id: 'key-1', name: 'Evaluation service', prefix: 'qym_19c2' },
    { id: 'key-2', name: 'Live worker', prefix: 'qym_b840' },
    { id: 'key-3', name: 'Performance runner', prefix: 'qym_7f3a' },
  ],
  active_run: null,
  settings: { fresh_within_s: 30, stale_after_s: 120, queue_timeout_s: 1800, late_window_s: 600 },
  connect: {
    project_id: performanceProject.id,
    runner_path: `/v1/projects/${performanceProject.id}/performance`,
  },
  can_manage: true,
};
/** The Runner page 6m 12s after the runner's last report. */
export const performanceRunnerReadSilent: PerformanceRunnerRead = {
  ...performanceRunnerRead,
  server_time: '2026-11-20T11:29:42Z',
  runner: performanceRunnerSilent,
};

export { playground17 as performanceTargetPlayground17, playground24 as performanceTargetPlayground24 };
export { preprod as performanceTargetPreprod, production as performanceTargetProduction };
