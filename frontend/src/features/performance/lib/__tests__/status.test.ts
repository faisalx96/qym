import { describe, expect, it } from 'vitest';
import type { PerformanceRunRead, PerformanceSummaryLevel } from '@/api/performance';
import {
  performanceRunBreakFound,
  performanceRunInterrupted,
  performanceRunPassed,
  performanceRunRunning,
  performanceRunStopped,
  performanceRunTokenNeeded,
} from '@/features/dev/performanceFixtures';
import { chartLevels } from '../../components/run/ChartsTab';
import { levelRows } from '../../components/run/levels';
import { OUTCOME_TONE, RUN_STATUS, isRunEnded, levelOutcomes, verdictWords } from '../status';

// A run's step, a test's result and a level's outcome: the words and tones every page of the area shows.

describe('the step of a run', () => {
  it('has the mark of the design for each step', () => {
    const marks = Object.fromEntries(
      Object.entries(RUN_STATUS).map(([status, { tone, shape, label }]) => [
        status,
        `${label}:${tone}:${shape}`,
      ]),
    );
    expect(marks).toEqual({
      queued: 'Queued:neutral:ring',
      starting: 'Starting:info:orbit',
      running: 'Running:info:orbit',
      stopping: 'Stopping:info:orbit',
      finished: 'Finished:success:full',
      stopped: 'Stopped:warning:pause',
      failed: 'Failed:danger:cross',
      interrupted: 'Interrupted:danger:cross',
      expired: 'Expired:neutral:pause',
    });
  });

  it('knows which steps can no longer change', () => {
    const ended = Object.keys(RUN_STATUS).filter((status) => isRunEnded(status as keyof typeof RUN_STATUS));
    expect(ended).toEqual(['finished', 'stopped', 'failed', 'interrupted', 'expired']);
  });
});

describe('the result of a test', () => {
  const facts = { safe_load_users: 40, breaking_level_users: 50 };
  it.each([
    ['breakpoint_found', ['warning', 'Breaks at 50 users']],
    ['not_reached', ['success', 'No break up to 40 users']],
    ['pass', ['success', 'Passed']],
    ['fail', ['danger', 'Failed']],
    ['invalid_auth', ['danger', 'Not valid: sign-in expired']],
    ['invalid_no_data', ['danger', 'Not valid: no answers']],
  ] as const)('%s', (verdict, words) => {
    expect(verdictWords({ ...facts, verdict })).toEqual(words);
  });

  it('says nothing while there is no result', () => {
    expect(verdictWords({ verdict: null, safe_load_users: null, breaking_level_users: null })).toBeNull();
  });
});

describe('the outcome of each level', () => {
  it('comes from the result once there is one, for the levels that have answers only', () => {
    expect(levelOutcomes(performanceRunBreakFound)).toEqual({
      10: 'pass',
      20: 'pass',
      30: 'pass',
      40: 'pass',
      50: 'break',
    });
  });

  it('keeps the judgement of a level a stop cut short', () => {
    expect(levelOutcomes(performanceRunStopped)).toMatchObject({ 30: 'pass' });
    expect(levelOutcomes(performanceRunStopped)[40]).toBeUndefined();
  });

  it('is measuring for the level the runner is on, while the run goes on', () => {
    expect(levelOutcomes(performanceRunRunning)).toEqual({ 10: 'pass', 20: 'pass', 30: 'measuring' });
  });

  it('is not counted for a level whose answers failed at the sign-in', () => {
    expect(levelOutcomes(performanceRunTokenNeeded)[30]).toBe('not_counted');
  });

  it('is not finished for the level a run was on when it ended without a result', () => {
    expect(levelOutcomes(performanceRunInterrupted)).toMatchObject({
      10: 'pass',
      20: 'pass',
      30: 'not_finished',
    });
    expect(levelOutcomes(performanceRunInterrupted)[40]).toBeUndefined();
  });

  it('judges the one hold of a Smoke or Soak run by the run’s verdict', () => {
    const hold = performanceRunPassed.config.plan.stages.find((stage) => stage.role === 'steady')!;
    expect(levelOutcomes(performanceRunPassed)).toEqual({ [hold.target_users]: 'pass' });
    const summary = performanceRunPassed.summary!;
    const judged = (verdict: typeof summary.verdict) =>
      levelOutcomes({ ...performanceRunPassed, summary: { ...summary, verdict } })[hold.target_users];
    expect(judged('fail')).toBe('break');
    expect(judged('invalid_auth')).toBe('not_counted');
    expect(judged('invalid_no_data')).toBe('break');
  });

  it('measures the hold of a Smoke run while it runs, and leaves it unfinished when the run is cut off', () => {
    const smoke = { ...performanceRunPassed, summary: null };
    const hold = smoke.config.plan.stages.find((stage) => stage.role === 'steady')!;
    const progress = {
      ...performanceRunRunning.progress!,
      phase: 'steady' as const,
      elapsed_s: hold.start_s + 30,
    };
    expect(levelOutcomes({ ...smoke, effective_status: 'running', progress })[hold.target_users]).toBe(
      'measuring',
    );
    expect(levelOutcomes({ ...smoke, effective_status: 'interrupted', progress })[hold.target_users]).toBe(
      'not_finished',
    );
    expect(
      levelOutcomes({ ...smoke, effective_status: 'failed', progress: { ...progress, elapsed_s: 0 } }),
    ).toEqual({});
  });

  it('reads the seeded Breakpoint result as the runner sends it: 10 passed, 20 broke the time limit', () => {
    // What frontend/scripts/seed_performance.py sends for its Breakpoint run: one entry per planned level, with
    // every field of a real result (has_data, the numbers, by_tier); the levels it never reached have no data.
    const tiers = (answers: number[], avg: number[], p95: number[]) => ({
      simple: { answers: answers[0]!, avg_ms: avg[0]!, p95_ms: p95[0]! },
      medium: { answers: answers[1]!, avg_ms: avg[1]!, p95_ms: p95[1]! },
      complex: { answers: answers[2]!, avg_ms: avg[2]!, p95_ms: p95[2]! },
    });
    const measured = {
      error_pct: 0,
      no_data_pct: 0,
      auth_error_pct: 0,
      auth_contaminated: false,
      quality_mean: 98,
      error_breach: false,
      has_data: true,
    };
    const passed: PerformanceSummaryLevel = {
      ...measured,
      level: 10,
      hold_start_s: 90,
      hold_end_s: 540,
      answers: 24,
      interrupted: 0,
      p50_ms: 21_000,
      p90_ms: 41_000,
      p95_ms: 48_000,
      p99_ms: 57_000,
      avg_ms: 24_500,
      min_ms: 9_100,
      max_ms: 60_000,
      ttfb_p50_ms: 9_800,
      ttfb_p95_ms: 15_000,
      follow_ups: 4,
      per_minute: 3.2,
      by_tier: tiers([12, 8, 4], [15_800, 27_400, 44_100], [26_000, 41_000, 57_000]),
      passed: true,
      latency_breach: false,
      result: 'pass',
      hold_elapsed_pct: 100,
    };
    const broke: PerformanceSummaryLevel = {
      ...measured,
      level: 20,
      hold_start_s: 570,
      hold_end_s: 1020,
      answers: 12,
      interrupted: 2,
      p50_ms: 61_000,
      p90_ms: 171_000,
      p95_ms: 196_000,
      p99_ms: 214_000,
      avg_ms: 82_300,
      min_ms: 12_400,
      max_ms: 221_000,
      ttfb_p50_ms: 18_400,
      ttfb_p95_ms: 31_000,
      follow_ups: 2,
      per_minute: 1.6,
      by_tier: tiers([6, 4, 2], [39_800, 88_400, 171_500], [71_000, 142_000, 214_000]),
      passed: false,
      latency_breach: true,
      result: 'break',
      hold_elapsed_pct: 40,
    };
    const noTier = { answers: null, avg_ms: null, p95_ms: null };
    const notReached = (level: number): PerformanceSummaryLevel => ({
      level,
      hold_start_s: 90 + (level / 10 - 1) * 480,
      hold_end_s: 540 + (level / 10 - 1) * 480,
      answers: 0,
      interrupted: 0,
      p50_ms: null,
      p90_ms: 0,
      p95_ms: 0,
      p99_ms: null,
      avg_ms: 0,
      min_ms: null,
      max_ms: 0,
      ttfb_p50_ms: null,
      ttfb_p95_ms: null,
      error_pct: 0,
      no_data_pct: null,
      auth_error_pct: null,
      auth_contaminated: false,
      quality_mean: 0,
      follow_ups: 0,
      per_minute: 0,
      by_tier: { simple: noTier, medium: noTier, complex: noTier },
      passed: false,
      latency_breach: false,
      error_breach: false,
      has_data: false,
      result: 'no_data',
      hold_elapsed_pct: 0,
    });
    const summary = performanceRunBreakFound.summary!;
    const seeded: PerformanceRunRead = {
      ...performanceRunBreakFound,
      summary: { ...summary, levels: [passed, broke, ...[30, 40, 50, 60].map(notReached)] },
    };
    expect(levelOutcomes(seeded)).toEqual({ 10: 'pass', 20: 'break' });
    expect(levelRows(seeded).map((row) => [row.level, row.word, row.note ?? null, row.p95_ms])).toEqual([
      [10, 'Passed', null, 48_000],
      [20, 'Broke the time limit', '40% of the hold ran', 196_000],
      [30, 'Not reached', null, null],
      [40, 'Not reached', null, null],
      [50, 'Not reached', null, null],
      [60, 'Not reached', null, null],
    ]);
    expect(chartLevels(seeded).filter((point) => point.p95_ms !== null)).toMatchObject([
      { level: 10, p95_ms: 48_000, by_kind: { simple: 26_000, medium: 41_000, complex: 57_000 } },
      { level: 20, p95_ms: 196_000, by_kind: { simple: 71_000, medium: 142_000, complex: 214_000 } },
    ]);
    // The short entries the seed sent before ({level, answers, result, hold_elapsed_pct}) carry no has_data,
    // so the page read both holds as not finished and drew no chart point.
    const short = [passed, broke].map(({ level, answers, result, hold_elapsed_pct }) => ({
      level,
      answers,
      result,
      hold_elapsed_pct,
    })) as unknown as PerformanceSummaryLevel[];
    expect(levelOutcomes({ ...seeded, summary: { ...summary, levels: short } })).toEqual({
      10: 'not_finished',
      20: 'not_finished',
    });
  });

  it('reads a result level that leaves out by_tier: the per-kind values are empty, nothing breaks', () => {
    // The guide lets a runner drop `by_tier` from a summary level (or a kind from it).
    const summary = performanceRunBreakFound.summary!;
    const [first, second, ...rest] = summary.levels;
    const { by_tier: _dropped, ...bare } = first!;
    const simple = second!.by_tier!.simple!;
    const oneKind: PerformanceSummaryLevel = { ...second!, by_tier: { simple } };
    const read: PerformanceRunRead = {
      ...performanceRunBreakFound,
      summary: { ...summary, levels: [bare, oneKind, ...rest] },
    };
    const none = { simple: null, medium: null, complex: null };
    const rows = levelRows(read);
    expect(rows[0]!.by_kind).toEqual(none);
    expect(rows[0]!.p95_ms).toBe(first!.p95_ms);
    expect(rows[1]!.by_kind).toEqual({ ...none, simple: simple.p95_ms });
    const points = chartLevels(read);
    expect(points[0]!.by_kind).toEqual(none);
    expect(points[0]!.p95_ms).toBe(first!.p95_ms);
    expect(points[1]!.by_kind).toEqual({ ...none, simple: simple.p95_ms });
  });

  it('gives a tone to every outcome, as the legend of the plan picture', () => {
    const read: Pick<PerformanceRunRead, 'summary' | 'progress' | 'effective_status'> = performanceRunRunning;
    for (const outcome of Object.values(levelOutcomes(read))) expect(OUTCOME_TONE[outcome]).toBeTruthy();
    expect(OUTCOME_TONE).toEqual({
      pass: 'success',
      break: 'danger',
      not_counted: 'warning',
      measuring: 'info',
      not_finished: 'neutral',
      waiting: 'neutral',
    });
  });
});
