/**
 * Performance area: the load plan of a run. Settings in; levels, stages, length, the recommended hold and
 * timeout, and the checks out.
 *
 * The test suite builds the same ladder when it runs, and the platform has the same rules for the start
 * route (`services/performance_plan.py`). The three share one file of cases,
 * `tests/platform/performance/plan_cases.json`; where a case there is disputed, this file gives the suite's
 * value. Pure functions: no clock, no requests.
 */
import type {
  PerformancePlan,
  PerformancePlanCheck,
  PerformancePlanInput,
  PerformancePlanStage,
  PerformanceStageRole,
  PerformanceTestType,
} from '@/api/performance';
import { formatElapsed } from '@/lib/dates';

/** Breakpoint ladder: one baseline stage, per level a ramp and a hold, two cooldown stages. */
export const BASELINE_SECONDS = 60;
export const RAMP_SECONDS = 30;
/** A ramping test starts with one user, so the baseline stage is a ramp from 1. */
export const START_USERS = 1;
/** Answers that begin in the first seconds of a run are not measured, in all three tests. */
export const WARMUP_SECONDS = 30;
/** Smoke is always one user for three minutes, whatever the settings say. */
export const SMOKE_USERS = 1;
export const SMOKE_SECONDS = 180;
/** One answer takes about this long; used to estimate how many a level collects. */
export const ANSWER_SECONDS = 55;
export const FEW_ANSWERS = 20;

const DEFAULT_FOLLOW_UP_RATE = 0.3;
const DEFAULT_MIN_QUALITY = 70;
const DEFAULT_MAX_NO_DATA_PCT = 20;

/** The settings of a run: any field of the plan input; those of another test type are ignored. */
export type PlanSettings = Partial<PerformancePlanInput>;

/** Limits a plan is held against; a limit that is absent or null is not checked. */
export interface PlanLimits {
  max_users?: number | null;
  /** Whose limit `max_users` is, for the sentence: the name of a target. */
  max_users_of?: string | null;
  max_total_seconds?: number | null;
}

/** Everything the page shows about a plan. */
export interface ComputedPlan {
  plan: PerformancePlan;
  levels: number[];
  stages: PerformancePlanStage[];
  total_seconds: number;
  /** Null for Smoke and Soak, which have no hold. */
  recommended_hold_seconds: number | null;
  recommended_timeout_seconds: number;
  checks: PerformancePlanCheck[];
  /** No check is 'bad': the plan itself does not stop a start. */
  ok: boolean;
}

/** Halves go up, as the suite rounds. */
const roundHalfUp = (value: number) => Math.floor(value + 0.5);

/** About 2.5 times the limit, in steps of 30 s, at least 120 s. The limit is rounded to whole seconds first. */
export function recommendedHoldSeconds(limitMs: number): number {
  const limitS = roundHalfUp(limitMs / 1000);
  return Math.max(120, roundHalfUp((2.5 * limitS) / 30) * 30);
}

/** Three times the limit in whole seconds (rounded up), between 180 and 900. */
export function recommendedTimeoutSeconds(limitMs: number): number {
  return Math.min(900, Math.max(180, Math.ceil((3 * limitMs) / 1000)));
}

/**
 * The measured levels: the step, twice the step, and so on up to the highest number of users. A highest
 * number that is not a multiple of the step is not reached; a step above it gives no level.
 */
export function planLevels(maxUsers: number, stepUsers: number): number[] {
  const levels: number[] = [];
  if (!(stepUsers >= 1) || !Number.isFinite(maxUsers)) return levels;
  for (let level = stepUsers; level <= maxUsers; level += stepUsers) levels.push(level);
  return levels;
}

/** The plan input as it is stored: fields of other test types are null, Smoke is fixed. */
export function normalizePlanInput(
  testType: PerformanceTestType,
  settings: PlanSettings,
): PerformancePlanInput {
  const input: PerformancePlanInput = {
    baseline_users: null,
    max_users: null,
    step_users: null,
    hold_seconds: null,
    follow_up_rate: null,
    abort_on_break: null,
    limit_ms: settings.limit_ms ?? 0,
    max_error_rate_pct: settings.max_error_rate_pct ?? 0,
    timeout_seconds: settings.timeout_seconds ?? 0,
    users: null,
    duration_seconds: null,
    min_quality: null,
    max_no_data_pct: null,
  };
  if (testType === 'breakpoint') {
    input.baseline_users = settings.baseline_users ?? START_USERS;
    input.max_users = settings.max_users ?? 0;
    input.step_users = settings.step_users ?? 0;
    input.hold_seconds = settings.hold_seconds ?? 0;
    input.follow_up_rate = settings.follow_up_rate ?? DEFAULT_FOLLOW_UP_RATE;
    input.abort_on_break = settings.abort_on_break ?? true;
    return input;
  }
  input.users = testType === 'smoke' ? SMOKE_USERS : (settings.users ?? SMOKE_USERS);
  input.duration_seconds = testType === 'smoke' ? SMOKE_SECONDS : (settings.duration_seconds ?? 0);
  input.min_quality = settings.min_quality ?? DEFAULT_MIN_QUALITY;
  input.max_no_data_pct = settings.max_no_data_pct ?? DEFAULT_MAX_NO_DATA_PCT;
  return input;
}

/** The plan with its levels, stages, length and warm-up: what the start route stores for a run. */
export function buildPlan(testType: PerformanceTestType, settings: PlanSettings): PerformancePlan {
  const input = normalizePlanInput(testType, settings);
  const stages: PerformancePlanStage[] = [];
  const push = (role: PerformanceStageRole, target_users: number, seconds: number) => {
    const start_s = stages[stages.length - 1]?.end_s ?? 0;
    stages.push({ role, target_users, start_s, end_s: start_s + seconds });
  };
  let levels: number[];
  if (testType === 'breakpoint') {
    const baseline = input.baseline_users ?? START_USERS;
    levels = planLevels(input.max_users ?? 0, input.step_users ?? 0);
    push('baseline', baseline, BASELINE_SECONDS);
    for (const level of levels) {
      push('ramp', level, RAMP_SECONDS);
      push('hold', level, input.hold_seconds ?? 0);
    }
    push('cooldown', baseline, RAMP_SECONDS);
    push('cooldown', 0, RAMP_SECONDS);
  } else {
    levels = [input.users ?? SMOKE_USERS];
    push('steady', input.users ?? SMOKE_USERS, input.duration_seconds ?? 0);
  }
  return {
    ...input,
    levels,
    total_seconds: stages[stages.length - 1]?.end_s ?? 0,
    warmup_seconds: WARMUP_SECONDS,
    stages,
  };
}

/** Users at the start of a stage: the stage before it ended there; the first starts at one. A steady stage is flat. */
export function stageStartUsers(stages: readonly PerformancePlanStage[], index: number): number {
  const stage = stages[index];
  if (!stage) return 0;
  if (stage.role === 'steady') return stage.target_users;
  return index === 0 ? START_USERS : (stages[index - 1]?.target_users ?? START_USERS);
}

/** Planned users at a second of the run: every stage moves in a straight line to its target. */
export function plannedUsersAt(stages: readonly PerformancePlanStage[], second: number): number {
  if (!stages.length) return 0;
  const found = stages.findIndex((stage) => second < stage.end_s);
  const index = found === -1 ? stages.length - 1 : found;
  const stage = stages[index]!;
  const start = stageStartUsers(stages, index);
  const length = stage.end_s - stage.start_s;
  const share = length <= 0 ? 1 : Math.min(1, Math.max(0, (second - stage.start_s) / length));
  return start + (stage.target_users - start) * share;
}

/** The most users the plan puts on the target at once. */
export function peakUsers(plan: Pick<PerformancePlan, 'stages'>): number {
  return Math.max(0, ...plan.stages.map((stage) => stage.target_users));
}

/** About how many answers the measured part collects: users times seconds held, one answer per 55 s. */
export function expectedAnswers(plan: Pick<PerformancePlan, 'stages'>): number {
  return plan.stages
    .filter((stage) => stage.role === 'hold' || stage.role === 'steady')
    .reduce((sum, stage) => sum + (stage.target_users * (stage.end_s - stage.start_s)) / ANSWER_SECONDS, 0);
}

/** 180000 -> '180s'; a limit that is not a whole number of seconds keeps its decimals. */
const limitWords = (limitMs: number) => `${Number((limitMs / 1000).toFixed(3))}s`;

const check = (
  code: PerformancePlanCheck['code'],
  tone: PerformancePlanCheck['tone'],
  message: string,
): PerformancePlanCheck => ({ code, tone, message });

/**
 * What the rules say about a built plan, in a fixed order; 'bad' means the run cannot start. With `limits`
 * the plan is also held against the highest number of users and the longest run allowed.
 */
export function planChecks(
  testType: PerformanceTestType,
  plan: PerformancePlan,
  limits: PlanLimits = {},
): PerformancePlanCheck[] {
  const checks: PerformancePlanCheck[] = [];
  if (testType === 'breakpoint') {
    const { levels } = plan;
    const limit = limitWords(plan.limit_ms);
    const hold = plan.hold_seconds ?? 0;
    const step = plan.step_users ?? 0;
    const max = plan.max_users ?? 0;
    const recommended = recommendedHoldSeconds(plan.limit_ms);
    if (!levels.length) {
      checks.push(
        check(
          'no_levels',
          'bad',
          `The step (${step}) is larger than the highest number of users (${max}), so no level would be measured.`,
        ),
      );
    } else if (max % step) {
      checks.push(
        check(
          'max_not_multiple_of_step',
          'warn',
          `The last measured level is ${levels[levels.length - 1]} users. ${max} is not a multiple of the step, so it is not reached.`,
        ),
      );
    }
    if (plan.timeout_seconds < plan.limit_ms / 1000) {
      checks.push(
        check(
          'timeout_below_limit',
          'bad',
          `An answer is given up after ${plan.timeout_seconds}s, before it can reach the ${limit} time limit. Raise the answer timeout.`,
        ),
      );
    }
    if (hold < recommended) {
      checks.push(
        check(
          'hold_short',
          'warn',
          `A hold of ${hold}s is short for a ${limit} limit: slow answers barely fit. Recommended hold: ${recommended}s.`,
        ),
      );
    } else {
      checks.push(
        check(
          'hold_ok',
          'ok',
          `Each level is held ${formatElapsed(hold)}, long enough to measure a ${limit} limit.`,
        ),
      );
    }
    const first = levels[0];
    if (first !== undefined && (first * hold) / ANSWER_SECONDS < FEW_ANSWERS) {
      checks.push(
        check(
          'first_level_few_answers',
          'warn',
          `The first level will collect about ${roundHalfUp((first * hold) / ANSWER_SECONDS)} answers. Fewer than ${FEW_ANSWERS} makes its p95 unreliable.`,
        ),
      );
    }
  } else if (testType === 'smoke') {
    checks.push(check('steady_ok', 'ok', 'One user for 3 minutes: two or three real answers.'));
  } else {
    const users = plan.users ?? 0;
    checks.push(
      check(
        'steady_ok',
        'ok',
        `${users} ${users === 1 ? 'user' : 'users'} for ${formatElapsed(plan.duration_seconds ?? 0)}.`,
      ),
    );
  }
  const peak = peakUsers(plan);
  if (limits.max_users != null && peak > limits.max_users) {
    checks.push(
      check(
        'over_max_users',
        'bad',
        limits.max_users_of
          ? `${limits.max_users_of} allows at most ${limits.max_users} users. This plan goes to ${peak}.`
          : `This plan goes to ${peak} users. At most ${limits.max_users} are allowed.`,
      ),
    );
  }
  if (limits.max_total_seconds != null && plan.total_seconds > limits.max_total_seconds) {
    checks.push(
      check(
        'over_max_duration',
        'bad',
        `This plan takes ${formatElapsed(plan.total_seconds)}. The longest run allowed is ${formatElapsed(limits.max_total_seconds)}.`,
      ),
    );
  }
  return checks;
}

/** Settings in; the plan, its stages, levels and length, the recommended hold and timeout, and the checks out. */
export function computePlan(
  testType: PerformanceTestType,
  settings: PlanSettings,
  limits: PlanLimits = {},
): ComputedPlan {
  const plan = buildPlan(testType, settings);
  const checks = planChecks(testType, plan, limits);
  return {
    plan,
    levels: plan.levels,
    stages: plan.stages,
    total_seconds: plan.total_seconds,
    recommended_hold_seconds: testType === 'breakpoint' ? recommendedHoldSeconds(plan.limit_ms) : null,
    recommended_timeout_seconds: recommendedTimeoutSeconds(plan.limit_ms),
    checks,
    ok: !checks.some((item) => item.tone === 'bad'),
  };
}
