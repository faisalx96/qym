/** The plan rules of the page against the cases the platform's port runs too (`plan_cases.json`). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PerformanceTestType } from '@/api/performance';
import {
  buildPlan,
  computePlan,
  expectedAnswers,
  normalizePlanInput,
  planChecks,
  plannedUsersAt,
  recommendedHoldSeconds,
  recommendedTimeoutSeconds,
  stageStartUsers,
  type PlanSettings,
} from '../plan';

interface PlanCase {
  name: string;
  dispute?: string;
  reading?: string;
  config: PlanSettings & { test_type: PerformanceTestType };
  expect: {
    levels: number[];
    total_seconds: number;
    recommended_hold_seconds: number | null;
    recommended_timeout_seconds: number;
    checks: string[];
    check_codes: string[];
    first_stage?: {
      role: string;
      from_users: number;
      to_users: number;
      start_second: number;
      end_second: number;
    };
    planned_users_at_second_30?: number;
    warmup_seconds?: number;
  };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
const DATA = JSON.parse(
  readFileSync(join(ROOT, 'tests', 'platform', 'performance', 'plan_cases.json'), 'utf-8'),
) as { cases: PlanCase[]; disputed_cases: PlanCase[] };

/**
 * Each dispute has two readings. D1 to D4: the suite's (how the test tool runs the plan and how its terminal
 * tool rounds). D5 to D7: the reading the undisputed cases already use, because a port cannot pass those
 * cases and the other reading at once. The platform's test makes the same choice.
 */
const SUITE_READING = new Set(['D1', 'D2', 'D3', 'D4']);
const chosen = (item: PlanCase) =>
  (item.reading ?? '').startsWith('kit.js') !== SUITE_READING.has(item.dispute ?? '');
const DISPUTED = DATA.disputed_cases.filter(chosen);
const REJECTED = DATA.disputed_cases.filter((item) => !chosen(item));

function result(item: PlanCase) {
  const { test_type: testType, ...settings } = item.config;
  const computed = computePlan(testType, settings);
  return {
    levels: computed.levels,
    total_seconds: computed.total_seconds,
    recommended_hold_seconds: computed.recommended_hold_seconds,
    recommended_timeout_seconds: computed.recommended_timeout_seconds,
    checks: computed.checks.map((check) => check.tone as string),
    check_codes: computed.checks.map((check) => check.code as string),
    ...(item.expect.first_stage
      ? {
          first_stage: {
            role: computed.stages[0]!.role,
            from_users: stageStartUsers(computed.stages, 0),
            to_users: computed.stages[0]!.target_users,
            start_second: computed.stages[0]!.start_s,
            end_second: computed.stages[0]!.end_s,
          },
        }
      : {}),
    ...(item.expect.planned_users_at_second_30 === undefined
      ? {}
      : { planned_users_at_second_30: plannedUsersAt(computed.stages, 30) }),
    ...(item.expect.warmup_seconds === undefined ? {} : { warmup_seconds: computed.plan.warmup_seconds }),
  };
}

describe('plan cases shared with the platform and the runner', () => {
  it('holds the cases this test expects', () => {
    expect(DATA.cases).toHaveLength(26);
    expect(DATA.disputed_cases).toHaveLength(16);
    expect(DISPUTED).toHaveLength(8);
  });

  it.each(DATA.cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(result(item)).toEqual(item.expect);
    const { test_type: testType, ...settings } = item.config;
    const plan = buildPlan(testType, settings);
    expect(plan.stages[plan.stages.length - 1]!.end_s).toBe(item.expect.total_seconds);
    expect(planChecks(testType, plan).every((check) => check.message.length > 0)).toBe(true);
  });

  it.each(DISPUTED.map((item) => [`${item.dispute}: ${item.name}`, item] as const))(
    'disputed, the reading in use: %s',
    (_name, item) => {
      expect(result(item)).toEqual(item.expect);
    },
  );

  it.each(REJECTED.map((item) => [`${item.dispute}: ${item.name}`, item] as const))(
    'disputed, the other reading is not what the page computes: %s',
    (_name, item) => {
      expect(result(item)).not.toEqual(item.expect);
    },
  );
});

describe('the plan of the sample run', () => {
  const settings: PlanSettings = {
    baseline_users: 5,
    max_users: 60,
    step_users: 10,
    hold_seconds: 450,
    limit_ms: 180_000,
    max_error_rate_pct: 10,
    timeout_seconds: 540,
  };

  it('builds one baseline stage, a ramp and a hold per level, and two cooldown stages', () => {
    const plan = buildPlan('breakpoint', settings);
    expect(plan.stages.map((stage) => stage.role)).toEqual([
      'baseline',
      ...Array.from({ length: 6 }).flatMap(() => ['ramp', 'hold']),
      'cooldown',
      'cooldown',
    ]);
    expect(plan.stages[2]).toEqual({ role: 'hold', target_users: 10, start_s: 90, end_s: 540 });
    expect(plan.stages[plan.stages.length - 1]).toEqual({
      role: 'cooldown',
      target_users: 0,
      start_s: 2970,
      end_s: 3000,
    });
    expect(plan.warmup_seconds).toBe(30);
    expect(plan.follow_up_rate).toBe(0.3);
    expect(plan.abort_on_break).toBe(true);
    expect(plan.users).toBeNull();
  });

  it('expects about 1,718 answers: users times hold over 55 s, all levels together', () => {
    expect(Math.round(expectedAnswers(buildPlan('breakpoint', settings)))).toBe(1718);
    expect(Math.round(expectedAnswers(buildPlan('soak', { users: 20, duration_seconds: 7200 })))).toBe(2618);
  });

  it('follows the ladder second by second', () => {
    const { stages } = buildPlan('breakpoint', settings);
    expect(plannedUsersAt(stages, 0)).toBe(1);
    expect(plannedUsersAt(stages, 60)).toBe(5);
    expect(plannedUsersAt(stages, 75)).toBe(7.5);
    expect(plannedUsersAt(stages, 300)).toBe(10);
    expect(plannedUsersAt(stages, 5000)).toBe(0);
    expect(plannedUsersAt([], 10)).toBe(0);
  });

  it('says the words of a check with no space before a time unit', () => {
    expect(computePlan('breakpoint', settings).checks).toEqual([
      {
        code: 'hold_ok',
        tone: 'ok',
        message: 'Each level is held 7m 30s, long enough to measure a 180s limit.',
      },
    ]);
  });
});

describe('limits a plan is held against', () => {
  const settings: PlanSettings = {
    baseline_users: 5,
    max_users: 80,
    step_users: 10,
    hold_seconds: 450,
    limit_ms: 180_000,
    max_error_rate_pct: 10,
    timeout_seconds: 540,
  };

  it('refuses a plan above the highest number of users of the target, naming the target', () => {
    const computed = computePlan('breakpoint', settings, { max_users: 60, max_users_of: 'Production' });
    expect(computed.ok).toBe(false);
    expect(computed.checks.at(-1)).toEqual({
      code: 'over_max_users',
      tone: 'bad',
      message: 'Production allows at most 60 users. This plan goes to 80.',
    });
    expect(computePlan('breakpoint', settings, { max_users: 80 }).ok).toBe(true);
    expect(computePlan('breakpoint', settings, { max_users: null }).ok).toBe(true);
  });

  it('refuses a plan longer than the longest run allowed', () => {
    const computed = computePlan(
      'soak',
      { users: 20, duration_seconds: 36_000 },
      { max_total_seconds: 28_800 },
    );
    expect(computed.checks.map((check) => check.code)).toEqual(['steady_ok', 'over_max_duration']);
    expect(computed.checks[1]!.message).toBe('This plan takes 10h. The longest run allowed is 8h.');
    expect(computed.ok).toBe(false);
  });

  it('counts the baseline users too when they are the most', () => {
    const computed = computePlan(
      'breakpoint',
      { ...settings, baseline_users: 90, max_users: 20 },
      { max_users: 60 },
    );
    expect(computed.checks.at(-1)!.code).toBe('over_max_users');
  });
});

describe('recommended values and stored input', () => {
  it('rounds halves up, and the limit to whole seconds first', () => {
    expect(recommendedHoldSeconds(150_000)).toBe(390);
    expect(recommendedHoldSeconds(54_000)).toBe(150);
    expect(recommendedHoldSeconds(53_500)).toBe(150);
    expect(recommendedHoldSeconds(30_000)).toBe(120);
    expect(recommendedTimeoutSeconds(100_500)).toBe(302);
    expect(recommendedTimeoutSeconds(400_000)).toBe(900);
    expect(recommendedTimeoutSeconds(30_000)).toBe(180);
  });

  it('keeps Smoke at one user for 180 s and nulls the fields of other tests', () => {
    const smoke = normalizePlanInput('smoke', {
      users: 3,
      duration_seconds: 600,
      max_users: 60,
      limit_ms: 60_000,
      max_error_rate_pct: 10,
      timeout_seconds: 180,
    });
    expect(smoke).toMatchObject({ users: 1, duration_seconds: 180, max_users: null, hold_seconds: null });
    const soak = normalizePlanInput('soak', { users: 20, duration_seconds: 7200, hold_seconds: 450 });
    expect(soak).toMatchObject({
      users: 20,
      duration_seconds: 7200,
      hold_seconds: null,
      follow_up_rate: null,
    });
  });
});
