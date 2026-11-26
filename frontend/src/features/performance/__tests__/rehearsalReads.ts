// Results as a real runner sent them in the end-to-end rehearsal (2026-11-22), copied field by field from the saved
// run reads (`lanes/rehearsal/check-*/run-read.json`): only the fields the run page reads, no token, no host. The
// page samples were written in the page's own words; these keep the runner's shapes: the engine's metric names
// and expressions, unrounded numbers, the suite's own sentence, fractional holds.
import type { PerformanceRunRead, PerformanceSummary } from '@/api/performance';
import {
  performanceRunBreakFound,
  performanceRunPassed,
  performanceRunStopped,
} from '@/features/dev/performanceFixtures';

type Level = Partial<PerformanceSummary['levels'][number]>;

/** A Breakpoint read of the samples, with the plan's limits and the result replaced by the rehearsal's. */
function breakpoint(
  base: PerformanceRunRead,
  plan: { limit_ms: number; max_error_rate_pct: number },
  summary: Partial<PerformanceSummary>,
  levels: Level[],
): PerformanceRunRead {
  const shape = base.summary!.levels;
  return {
    ...base,
    config: {
      ...base.config,
      plan: { ...base.config.plan, ...plan, levels: levels.map((item) => item.level!) },
    },
    run: { ...base.run, duration_s: summary.headline!.duration_s },
    summary: {
      ...base.summary!,
      ...summary,
      levels: levels.map((item, index) => ({ ...shape[index]!, ...item })),
    },
  };
}

/** check-5-next-run: broke at 4 users on the time limit and stopped by itself. */
export const rehearsalBreaks = breakpoint(
  performanceRunBreakFound,
  { limit_ms: 4000, max_error_rate_pct: 10 },
  {
    verdict: 'breakpoint_found',
    verdict_reason: 'Breaks at 4 VUs (latency).',
    ended_by: 'auto_stop',
    headline: {
      ...performanceRunBreakFound.summary!.headline,
      p95_ms: 4737.699999999999,
      max_users: 4,
      duration_s: 177.985911624,
      quality_mean: 100,
      answers_total: 31,
      error_rate_pct: 0,
      breaking_reason: 'latency',
      safe_load_users: 2,
      answers_measured: 13,
      p95_at_safe_load_ms: 2316.1,
      breaking_level_users: 4,
      recommended_max_users: 1,
    },
    thresholds: [
      {
        ok: false,
        scope: 'run',
        metric: 'llm_response_duration',
        measured: 4737.699999999999,
        expression: 'p(95)<4000',
      },
      { ok: true, scope: 'run', metric: 'http_req_failed', measured: 0, expression: 'rate<0.1' },
    ],
    counts: {
      by_tier: { medium: 2, simple: 10, complex: 1 },
      follow_ups: 7,
      iterations: 20,
      interrupted: 0,
    },
  },
  [
    {
      level: 2,
      result: 'pass',
      latency_breach: false,
      error_breach: false,
      has_data: true,
      hold_elapsed_pct: 100,
      answers: 3,
      p95_ms: 2316.1,
      error_pct: 0,
    },
    {
      level: 4,
      result: 'break',
      latency_breach: true,
      error_breach: false,
      has_data: true,
      hold_elapsed_pct: 93.3,
      answers: 10,
      p95_ms: 5265.25,
      error_pct: 0,
    },
    {
      level: 6,
      result: 'no_data',
      latency_breach: false,
      error_breach: false,
      has_data: false,
      hold_elapsed_pct: 0,
      answers: 0,
      p95_ms: 0,
      error_pct: 0,
    },
  ],
);

/** check-3-stop: stopped by a person 38.6% into the first hold. */
export const rehearsalStopped = breakpoint(
  performanceRunStopped,
  { limit_ms: 4000, max_error_rate_pct: 10 },
  {
    verdict: 'not_reached',
    verdict_reason: 'All clean hold levels with data stayed within the configured latency and error limits.',
    ended_by: 'stop',
    headline: {
      ...performanceRunStopped.summary!.headline,
      p95_ms: 3029.5,
      duration_s: 105.451254493,
      safe_load_users: 2,
      breaking_level_users: null,
      breaking_reason: null,
      p95_at_safe_load_ms: 2384.5,
      recommended_max_users: 1,
    },
    thresholds: [
      { ok: true, scope: 'run', metric: 'llm_response_duration', measured: 3029.5, expression: 'p(95)<4000' },
      { ok: true, scope: 'run', metric: 'http_req_failed', measured: 0, expression: 'rate<0.1' },
    ],
    counts: { ...performanceRunStopped.summary!.counts!, interrupted: 0 },
  },
  [
    { level: 2, result: 'pass', has_data: true, hold_elapsed_pct: 38.6 },
    { level: 4, result: 'no_data', has_data: false, hold_elapsed_pct: 0 },
    { level: 6, result: 'no_data', has_data: false, hold_elapsed_pct: 0 },
  ],
);

/** check-4-token: a Soak run that passed, with the four limits the suite sets for Smoke and Soak. */
export const rehearsalSoak: PerformanceRunRead = {
  ...performanceRunPassed,
  config: { ...performanceRunPassed.config, test_type: 'soak' },
  summary: {
    ...performanceRunPassed.summary!,
    test_type: 'soak',
    verdict: 'pass',
    verdict_reason: null,
    ended_by: 'plan',
    headline: {
      ...performanceRunPassed.summary!.headline,
      p95_ms: 3110.9999999999995,
      max_users: 3,
      duration_s: 210,
      quality_mean: 97.72727272727273,
      answers_total: 40,
      errors_total: 3,
      error_rate_pct: 7.5,
    },
    thresholds: [
      { ok: true, scope: 'run', metric: 'llm_false_negative_rate', measured: 0, expression: 'rate<0.2' },
      {
        ok: true,
        scope: 'run',
        metric: 'llm_quality_score',
        measured: 97.72727272727273,
        expression: 'avg>70',
      },
      {
        ok: true,
        scope: 'run',
        metric: 'http_req_failed',
        measured: 0.06818181818181818,
        expression: 'rate<0.1',
      },
      {
        ok: true,
        scope: 'run',
        metric: 'llm_response_duration',
        measured: 3110.9999999999995,
        expression: 'p(95)<180000',
      },
    ],
  },
};

// Second rehearsal (2026-11-22, `lanes/rehearsal-2/`).

/** check-1-verdict: broke at 6 users; 55 questions stored, 53 answered and 2 cut off at the end. */
const broke2 = breakpoint(
  performanceRunBreakFound,
  { limit_ms: 4000, max_error_rate_pct: 10 },
  {
    verdict: 'breakpoint_found',
    verdict_reason: 'Breaks at 6 VUs (latency).',
    ended_by: 'auto_stop',
    headline: {
      ...performanceRunBreakFound.summary!.headline,
      p95_ms: 3712.3499999999995,
      max_users: 6,
      duration_s: 237.93918801400002,
      answers_total: 53,
      breaking_reason: 'latency',
      safe_load_users: 4,
      answers_measured: 23,
      p95_at_safe_load_ms: 3714.6,
      breaking_level_users: 6,
      recommended_max_users: 3,
    },
  },
  [
    {
      level: 2,
      result: 'pass',
      has_data: true,
      hold_elapsed_pct: 100,
      answers: 4,
      p95_ms: 2351.6499999999996,
      error_pct: 0,
    },
    {
      level: 4,
      result: 'pass',
      has_data: true,
      hold_elapsed_pct: 100,
      answers: 8,
      p95_ms: 3714.6,
      error_pct: 0,
    },
    {
      level: 6,
      result: 'break',
      latency_breach: true,
      error_breach: false,
      has_data: true,
      hold_elapsed_pct: 93.1,
      answers: 11,
      p95_ms: 4904,
      error_pct: 0,
    },
  ],
);
export const rehearsal2Broke: PerformanceRunRead = {
  ...broke2,
  run: { ...broke2.run, answers_total: 53 },
  counts: { ...broke2.counts, questions_received: 55, questions_dropped: 0 },
};

/** check-3-stop: stopped 63.7% into the first hold; 6 answers came back, none inside a hold. */
const stopped2 = breakpoint(
  performanceRunStopped,
  { limit_ms: 4000, max_error_rate_pct: 10 },
  {
    verdict: 'invalid_no_data',
    verdict_reason: 'No hold level collected usable request samples, so capacity could not be assessed.',
    ended_by: 'stop',
    headline: {
      ...performanceRunStopped.summary!.headline,
      p95_ms: 18378.3,
      max_users: 2,
      duration_s: 115.480659387,
      quality_mean: null,
      answers_total: 6,
      safe_load_users: 0,
      answers_measured: 0,
      p95_at_safe_load_ms: null,
      breaking_level_users: null,
      breaking_reason: null,
      recommended_max_users: 0,
    },
    counts: { ...performanceRunStopped.summary!.counts!, interrupted: 0 },
  },
  [
    {
      level: 2,
      result: 'no_data',
      has_data: false,
      hold_elapsed_pct: 63.7,
      answers: 0,
      p95_ms: 0,
      error_pct: 0,
    },
    {
      level: 4,
      result: 'no_data',
      has_data: false,
      hold_elapsed_pct: 0,
      answers: 0,
      p95_ms: 0,
      error_pct: 0,
    },
    {
      level: 6,
      result: 'no_data',
      has_data: false,
      hold_elapsed_pct: 0,
      answers: 0,
      p95_ms: 0,
      error_pct: 0,
    },
  ],
);
export const rehearsal2Stopped: PerformanceRunRead = {
  ...stopped2,
  run: { ...stopped2.run, answers_total: 6, verdict: 'invalid_no_data' },
  counts: { ...stopped2.counts, questions_received: 7, questions_dropped: 0 },
};

// The third rehearsal (2026-11-22, `lanes/rehearsal-3/check-1-verdict/run-read.json`): no level broke, but the
// whole-run time limit did, and the suite stopped the run 2 s into the level-6 hold (`auto_stop`, exit 99).
const runLimit3 = breakpoint(
  performanceRunBreakFound,
  { limit_ms: 4000, max_error_rate_pct: 10 },
  {
    verdict: 'not_reached',
    verdict_reason: 'All clean hold levels with data stayed within the configured latency and error limits.',
    ended_by: 'auto_stop',
    exit_code: 99,
    headline: {
      ...performanceRunBreakFound.summary!.headline,
      p95_ms: 4426.249999999997,
      max_users: 6,
      duration_s: 211.96948971,
      ttfb_p95_ms: 2277,
      errors_total: 0,
      quality_mean: 100,
      answers_total: 41,
      error_rate_pct: 0,
      breaking_reason: null,
      safe_load_users: 4,
      answers_measured: 14,
      p95_at_safe_load_ms: 3303.85,
      breaking_level_users: null,
      recommended_max_users: 3,
    },
    thresholds: [
      {
        ok: false,
        scope: 'run',
        metric: 'llm_response_duration',
        measured: 4426.249999999997,
        expression: 'p(95)<4000',
      },
      { ok: true, scope: 'run', metric: 'http_req_failed', measured: 0, expression: 'rate<0.1' },
    ],
  },
  [
    {
      level: 2,
      answers: 4,
      has_data: true,
      result: 'pass',
      hold_elapsed_pct: 100,
      error_pct: 0,
      per_minute: 8,
      passed: true,
      latency_breach: false,
      error_breach: false,
      p95_ms: 2872.45,
    },
    {
      level: 4,
      answers: 10,
      has_data: true,
      result: 'pass',
      hold_elapsed_pct: 100,
      error_pct: 0,
      per_minute: 20,
      passed: true,
      latency_breach: false,
      error_breach: false,
      p95_ms: 3303.85,
    },
    {
      level: 6,
      answers: 0,
      has_data: false,
      result: 'no_data',
      hold_elapsed_pct: 6.6,
      error_pct: 0,
      per_minute: 0,
      passed: false,
      latency_breach: false,
      error_breach: false,
      p95_ms: 0,
    },
  ],
);
export const rehearsal3RunLimit: PerformanceRunRead = {
  ...runLimit3,
  run: { ...runLimit3.run, verdict: 'not_reached', answers_total: 41 },
};
