/** Performance area: a run's state, a test's result and a level's outcome, as words and a tone. */
import type {
  PerformanceLevelResult,
  PerformanceRunRead,
  PerformanceRunStatus,
  PerformanceVerdict,
} from '@/api/performance';
import type { StateTagTone, StatusShape, StatusTone } from '@/ui';

// ---------- the step of a run ----------

export interface RunStatusWords {
  tone: StatusTone;
  shape: StatusShape;
  label: string;
}

/** The step of a run. A step is shown as a StatusMark, never as a tag. */
export const RUN_STATUS: Record<PerformanceRunStatus, RunStatusWords> = {
  queued: { tone: 'neutral', shape: 'ring', label: 'Queued' },
  starting: { tone: 'info', shape: 'orbit', label: 'Starting' },
  running: { tone: 'info', shape: 'orbit', label: 'Running' },
  stopping: { tone: 'info', shape: 'orbit', label: 'Stopping' },
  finished: { tone: 'success', shape: 'full', label: 'Finished' },
  stopped: { tone: 'warning', shape: 'pause', label: 'Stopped' },
  failed: { tone: 'danger', shape: 'cross', label: 'Failed' },
  interrupted: { tone: 'danger', shape: 'cross', label: 'Interrupted' },
  expired: { tone: 'neutral', shape: 'pause', label: 'Expired' },
};

const ENDED: readonly PerformanceRunStatus[] = ['finished', 'stopped', 'failed', 'interrupted', 'expired'];

/** True once a run can no longer change its state. */
export const isRunEnded = (status: PerformanceRunStatus) => ENDED.includes(status);

// ---------- the result of a test ----------

export interface VerdictFacts {
  verdict: PerformanceVerdict | null;
  safe_load_users: number | null;
  breaking_level_users: number | null;
}

/** The result of the test in words: 'Breaks at 50 users', 'No break up to 60 users', 'Passed'. */
export function verdictWords(run: VerdictFacts): [StateTagTone, string] | null {
  switch (run.verdict) {
    case 'breakpoint_found':
      return ['warning', `Breaks at ${run.breaking_level_users} users`];
    case 'not_reached':
      return ['success', `No break up to ${run.safe_load_users} users`];
    case 'pass':
      return ['success', 'Passed'];
    case 'fail':
      return ['danger', 'Failed'];
    case 'invalid_auth':
      return ['danger', 'Not valid: sign-in expired'];
    case 'invalid_no_data':
      return ['danger', 'Not valid: no answers'];
    default:
      return null;
  }
}

// ---------- the outcome of one level ----------

/**
 * How one level ended, or stands now. `not_finished`: the run ended without a result while this hold was
 * running, so part of it ran and it was never judged.
 */
export type LevelOutcome = 'pass' | 'break' | 'not_counted' | 'measuring' | 'not_finished' | 'waiting';

export const OUTCOME_TONE = {
  pass: 'success',
  break: 'danger',
  not_counted: 'warning',
  measuring: 'info',
  not_finished: 'neutral',
  waiting: 'neutral',
} as const satisfies Record<LevelOutcome, StateTagTone>;

export const OUTCOME_WORDS: Record<LevelOutcome, string> = {
  pass: 'Passed',
  break: 'Broke a limit',
  not_counted: 'Not counted',
  measuring: 'Measuring now',
  not_finished: 'Not finished',
  waiting: 'Not measured',
};

const byResult = (result: PerformanceLevelResult): LevelOutcome =>
  result === 'pass' ? 'pass' : result === 'break' ? 'break' : result === 'auth' ? 'not_counted' : 'waiting';

type OutcomeFacts = Pick<PerformanceRunRead, 'summary' | 'progress' | 'effective_status'> & {
  /** Needed for a Smoke or Soak run: its one hold is judged by the run's verdict, not level by level. */
  config?: Pick<PerformanceRunRead['config'], 'test_type' | 'plan'>;
};

const measuringNow = (read: OutcomeFacts) =>
  read.effective_status === 'running' || read.effective_status === 'stopping';

/** The one hold of a Smoke or Soak run: from the verdict, else from where the run is or stopped. */
function steadyOutcome(read: OutcomeFacts, hold: { start_s: number }): LevelOutcome | undefined {
  const verdict = read.summary?.verdict;
  if (verdict) return verdict === 'pass' ? 'pass' : verdict === 'invalid_auth' ? 'not_counted' : 'break';
  const progress = read.progress;
  if (!progress) return undefined;
  if (measuringNow(read)) return progress.phase === 'steady' ? 'measuring' : undefined;
  return progress.elapsed_s > hold.start_s ? 'not_finished' : undefined;
}

/**
 * The outcome of every level a run has reached: from its result when it has one, else from its last report.
 * A level that is absent was not reached (or is still waiting).
 */
export function levelOutcomes(read: OutcomeFacts): Record<number, LevelOutcome> {
  const out: Record<number, LevelOutcome> = {};
  const config = read.config;
  if (config && config.test_type !== 'breakpoint') {
    const hold = config.plan.stages.find((stage) => stage.role === 'steady' || stage.role === 'hold');
    const outcome = hold ? steadyOutcome(read, hold) : undefined;
    if (hold && outcome) out[hold.target_users] = outcome;
    return out;
  }
  if (read.summary) {
    for (const level of read.summary.levels)
      if (level.has_data) out[level.level] = byResult(level.result);
      // A hold that began and has no answer in it (a stop early in the hold) was not finished.
      else if ((level.hold_elapsed_pct ?? 0) > 0) out[level.level] = 'not_finished';
    return out;
  }
  for (const level of read.progress?.levels ?? [])
    out[level.level] =
      level.state === 'running' && level.result !== 'auth'
        ? measuringNow(read)
          ? 'measuring'
          : 'not_finished'
        : byResult(level.result);
  return out;
}
