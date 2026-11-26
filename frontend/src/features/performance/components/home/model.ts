/** Performance home: what the page works out from its reads. No markup here. */
import type {
  PerformanceActiveRun,
  PerformanceHome,
  PerformancePlanStage,
  PerformanceProgress,
  PerformanceRunRow,
  PerformanceRunsFilters,
  PerformanceVerdict,
} from '@/api/performance';
import { formatShortDay } from '@/lib/dates';
import { span } from '../../lib/format';
import { levelOutcomes, type LevelOutcome } from '../../lib/status';

/** Rows of one page of the runs table (the API's default). */
export const RUNS_PAGE_SIZE = 25;

// ---------- the run in progress ----------

/** The stage of the plan a second falls in; null before the plan starts and after it ends. */
export function stageAt(stages: PerformancePlanStage[], second: number): PerformancePlanStage | null {
  return stages.find((stage) => second >= stage.start_s && second < stage.end_s) ?? null;
}

/** The most users the plan reaches; null when the plan is not known. */
export function planTop(stages: PerformancePlanStage[]): number | null {
  return stages.length ? Math.max(...stages.map((stage) => stage.target_users)) : null;
}

/** Users at second 0: the plan's first stage when it is the warm-up, else none. */
export function planBaseline(stages: PerformancePlanStage[]): number {
  return stages[0]?.role === 'baseline' ? stages[0].target_users : 0;
}

/** What comes after the stage the run is in, as the quiet line under "Level now". */
export function comingUp(active: PerformanceActiveRun): string | undefined {
  const stages = active.stages ?? [];
  if (active.elapsed_s === null) return undefined;
  const now = stageAt(stages, active.elapsed_s);
  if (!now) return undefined;
  const left = span(Math.max(0, now.end_s - active.elapsed_s));
  const later = stages.some((stage) => stage.role === 'hold' && stage.start_s >= now.end_s);
  if (now.role === 'hold') return later ? `next level in ${left}` : `last level, ${left} left`;
  if (now.role === 'ramp') return `going up to ${now.target_users} users`;
  if (now.role === 'baseline') return `warming up, ${left} left`;
  if (now.role === 'cooldown') return 'winding down';
  return undefined;
}

/** The outcome of each level the run in progress has reached, by the rule the run page uses. */
export function activeOutcomes(active: PerformanceActiveRun): Record<number, LevelOutcome> {
  // The shared rule reads the run page's shape and only its levels; Home has the same levels on the active run.
  const progress = { levels: active.levels ?? [] } as PerformanceProgress;
  return levelOutcomes({ summary: null, progress, effective_status: active.status });
}

/** The levels that passed so far, in users. */
export function passedLevels(active: PerformanceActiveRun): number[] {
  return Object.entries(activeOutcomes(active))
    .filter(([, outcome]) => outcome === 'pass')
    .map(([level]) => Number(level));
}

// ---------- the capacity of one target ----------

const WITH_RESULT: PerformanceVerdict[] = ['breakpoint_found', 'not_reached'];
const NOT_VALID: PerformanceVerdict[] = ['invalid_auth', 'invalid_no_data'];
const NOT_VALID_WORDS: Partial<Record<PerformanceVerdict, string>> = {
  invalid_auth: 'sign-in expired',
  invalid_no_data: 'no answers',
};

/** The Breakpoint runs of one target that the capacity block reads: with a result, or left out as not valid. */
export function capacityFilters(targetId: string): PerformanceRunsFilters {
  return {
    target: targetId,
    test_type: ['breakpoint'],
    verdict: [...WITH_RESULT, ...NOT_VALID],
    page_size: 30,
  };
}

/**
 * The newest Breakpoint run that gave a result: finished, with a verdict. A stopped run ended early, so it is not
 * the capacity answer; the safe-load chart below reads finished runs only, by the same rule (`home` on the platform).
 */
export function latestResult(rows: PerformanceRunRow[]): PerformanceRunRow | null {
  return (
    rows.find(
      (run) => run.status === 'finished' && run.verdict !== null && WITH_RESULT.includes(run.verdict),
    ) ?? null
  );
}

export type TrendPoint = PerformanceHome['safe_load_trend'][number];

/** One target's points of the trend, oldest first. */
export function trendOf(home: PerformanceHome, targetId: string): TrendPoint[] {
  return home.safe_load_trend.filter((point) => point.target_id === targetId);
}

/** The runs inside the charted time that gave no valid result, each with the reason in words. */
export function leftOut(rows: PerformanceRunRow[], points: TrendPoint[]): string[] {
  const first = points[0];
  if (!first) return [];
  const from = Date.parse(first.finished_at);
  return rows
    .filter((run) => run.verdict !== null && NOT_VALID.includes(run.verdict))
    .filter((run) => Date.parse(run.finished_at ?? run.requested_at) >= from)
    .map(
      (run) =>
        `run ${run.number} (${formatShortDay(run.started_at ?? run.requested_at)}, ${NOT_VALID_WORDS[run.verdict!]})`,
    );
}

/** One name per point: its day, with the run number where two runs share a day. */
export function trendNames(points: TrendPoint[]): string[] {
  const days = points.map((point) => formatShortDay(point.finished_at));
  return days.map((day, index) =>
    days.indexOf(day) === days.lastIndexOf(day) ? day : `${day} · run ${points[index]!.number}`,
  );
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

/** The top of the users axis: four even steps that leave room above the highest value. */
export function axisTop(highest: number): number {
  const step = STEPS.find((candidate) => candidate * 4 >= highest * 1.1) ?? STEPS[STEPS.length - 1]!;
  return step * 4;
}

/** The target the capacity block opens on: the one being tested, else the one tested last, else the first. */
export function defaultTargetId(home: PerformanceHome): string | null {
  const open = home.targets.filter((target) => !target.archived);
  const known = (id: string | null | undefined) => Boolean(id && open.some((target) => target.id === id));
  if (known(home.active_run?.target.id)) return home.active_run!.target.id;
  const newest = home.runs.rows.find((run) => known(run.target.id));
  return newest?.target.id ?? open[0]?.id ?? null;
}
