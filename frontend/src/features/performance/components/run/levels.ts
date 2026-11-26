/** Performance run page: one row per planned level, from the result when there is one, else from the last report. */
import {
  isPerformanceRunActive,
  type PerformanceRunRead,
  type PerformanceSummaryLevel,
  type PerformanceTier,
} from '@/api/performance';
import { formatTime } from '@/lib/dates';
import { plus } from '../../lib/format';
import { levelOutcomes, type LevelOutcome } from '../../lib/status';
import { heldPct } from './words';

export interface LevelRow {
  level: number;
  outcome: LevelOutcome;
  /** The outcome in the words of the Result cell. */
  word: string;
  /** The quiet line under the outcome: how much of the hold ran, or when the level starts. */
  note?: string;
  answers: number | null;
  per_minute: number | null;
  error_pct: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  first_byte_ms: number | null;
  quality: number | null;
  no_data_pct: number | null;
  by_kind: Record<PerformanceTier, number | null>;
}

/** What a runner may send as `by_tier`: the guide lets it leave the whole field, or one kind, out of a level. */
type SentTiers = Partial<Record<PerformanceTier, { p95_ms: number | null } | null>> | null | undefined;

/**
 * The p95 of each kind of question at one level of the result. A level without `by_tier` (or without one kind) has no
 * value for it: its per-kind cells and chart points stay empty, as for a kind with no answers.
 */
export function tierP95(
  level: Pick<PerformanceSummaryLevel, 'by_tier'>,
): Record<PerformanceTier, number | null> {
  const tiers: SentTiers = level.by_tier;
  return {
    simple: tiers?.simple?.p95_ms ?? null,
    medium: tiers?.medium?.p95_ms ?? null,
    complex: tiers?.complex?.p95_ms ?? null,
  };
}

/** p99 is shown for a level with at least this many answers. */
export const P99_MIN_ANSWERS = 200;

const NO_NUMBERS = {
  answers: null,
  per_minute: null,
  error_pct: null,
  p50_ms: null,
  p95_ms: null,
  p99_ms: null,
  first_byte_ms: null,
  quality: null,
  no_data_pct: null,
  by_kind: { simple: null, medium: null, complex: null },
};

export function levelRows(read: PerformanceRunRead): LevelRow[] {
  const { config, summary, progress, run } = read;
  const outcomes = levelOutcomes(read);
  const done = !isPerformanceRunActive(read.effective_status);
  return config.plan.levels.map((users): LevelRow => {
    const outcome = outcomes[users] ?? 'waiting';
    const hold = config.plan.stages.find((stage) => stage.role === 'hold' && stage.target_users === users);
    const final = summary?.levels.find((item) => item.level === users);
    if (final?.has_data)
      return {
        level: users,
        outcome,
        word:
          final.result === 'pass'
            ? 'Passed'
            : final.result === 'auth'
              ? 'Not counted'
              : final.result === 'break'
                ? final.error_breach && !final.latency_breach
                  ? 'Broke the error limit'
                  : 'Broke the time limit'
                : 'No answers',
        // A hold a stop cut short is judged as the suite judged it, and says how much of it ran.
        note:
          final.hold_elapsed_pct !== null && final.hold_elapsed_pct < 100
            ? `${heldPct(final.hold_elapsed_pct)}% of the hold ran`
            : undefined,
        answers: final.answers,
        per_minute: final.per_minute,
        error_pct: final.error_pct,
        p50_ms: final.p50_ms,
        p95_ms: final.p95_ms,
        p99_ms: (final.answers ?? 0) >= P99_MIN_ANSWERS ? final.p99_ms : null,
        first_byte_ms: final.ttfb_p95_ms,
        quality: final.quality_mean,
        no_data_pct: final.no_data_pct,
        by_kind: tierP95(final),
      };
    // A level without data may send no numbers at all (guide 4.7): null reads as a hold that never began.
    const held = final?.hold_elapsed_pct ?? 0;
    if (final && held > 0)
      return {
        ...NO_NUMBERS,
        level: users,
        outcome,
        word: 'Not finished',
        note: `${heldPct(held)}% of the hold ran, no answers`,
        answers: final.answers,
      };
    const live = summary ? undefined : progress?.levels.find((item) => item.level === users);
    if (live)
      return {
        ...NO_NUMBERS,
        level: users,
        outcome,
        word:
          live.state === 'running'
            ? live.result === 'auth'
              ? 'Not counted'
              : done
                ? 'Not finished'
                : 'Measuring'
            : live.result === 'pass'
              ? 'Passed'
              : live.result === 'auth'
                ? 'Not counted'
                : live.result === 'no_data'
                  ? 'No answers'
                  : live.reason === 'errors'
                    ? 'Broke the error limit'
                    : live.reason === 'latency'
                      ? 'Broke the time limit'
                      : 'Broke a limit',
        note:
          live.result === 'auth'
            ? 'sign-in errors'
            : live.state === 'running'
              ? `${heldPct(live.hold_elapsed_pct)}% of the hold${done ? ' ran' : ''}`
              : undefined,
        answers: live.answers,
        per_minute: live.per_minute,
        error_pct: live.error_pct,
        p50_ms: live.p50_ms,
        p95_ms: live.p95_ms,
        first_byte_ms: live.ttfb_p95_ms,
        quality: live.quality_mean,
        no_data_pct: live.no_data_pct,
      };
    return {
      ...NO_NUMBERS,
      level: users,
      outcome,
      word: done ? 'Not reached' : 'Waiting',
      note:
        !done && hold && run.started_at
          ? `starts at ${formatTime(plus(run.started_at, hold.start_s))}`
          : undefined,
    };
  });
}
