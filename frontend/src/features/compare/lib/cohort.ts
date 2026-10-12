/**
 * Cohort (Sweep) comparison: A vs B with k executions each. Ports
 * metrics.js calculateGroupedCohortComparison and compare.html
 * summarizeSweepItems / filterSweepItems (brief 05 J2). Only items with a
 * score or an error in every selected run are eligible; errors follow
 * getRowScore (count as 0, or are left out when lower is better; an errored
 * entry never passes then).
 */
import { type MetricDirection } from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import { getMetadataCategoryValues, isListCategoryKey } from '@/features/run-detail/lib/rowMeta';
import type { CompareModel, CompareRun } from './model';
import { computeSweepNoise, passAtK, passHatK, type NoiseReport } from './noise';
import { runOutcome, verdictOf, type MetricCtx } from './scoring';
import { SKIPPED_METADATA } from './skipMetadata';
import type { Cohorts } from './refs';

export interface CohortGroups {
  left: string[];
  right: string[];
  leftLabel: string;
  rightLabel: string;
  explicit: boolean;
  /** Executions per cohort. */
  k: number;
}

const GENERIC_LABELS = new Set(['cohort a', 'cohort b', 'model a', 'model b', 'left cohort', 'right cohort']);

function opaque(text: string): boolean {
  return !text.trim() || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text.trim());
}

function commonPrefix(values: string[]): string {
  const list = values.filter(Boolean);
  if (!list.length) return '';
  let prefix = list[0] ?? '';
  for (const v of list.slice(1)) {
    let j = 0;
    while (j < prefix.length && j < v.length && prefix[j] === v[j]) j += 1;
    prefix = prefix.slice(0, j);
  }
  return prefix.replace(/[-_\s.,/:]+$/g, '').trim();
}

/** A label a user gave, else derived from the run names of the side. */
export function deriveCohortLabel(runs: CompareRun[], provided: string): string {
  const label = provided.trim();
  if (label && !GENERIC_LABELS.has(label.toLowerCase()) && !label.includes(',') && !/\+\d+$/.test(label))
    return label;
  const names = Array.from(
    new Set(runs.map((r) => String(r.run.base_run_name || r.run.run_name || r.base).trim()).filter(Boolean)),
  );
  if (!names.length) return 'Cohort';
  if (names.length === 1) return names[0] ?? 'Cohort';
  const pool = names.filter((n) => !opaque(n));
  const source = pool.length ? pool : names;
  const stem = commonPrefix(source);
  if (stem.length >= 8 && !opaque(stem)) return stem;
  return source[0] ?? 'Cohort';
}

/**
 * Explicit cohorts from the URL (refs expanded to passes), else two models with
 * equal run counts (compare.html inferGroupedOutcomeGroups).
 */
export function resolveCohorts(
  model: CompareModel,
  explicit: { left: string[]; right: string[]; leftLabel: string; rightLabel: string } | null,
): CohortGroups | null {
  const byRef = new Map(model.runs.map((r) => [r.ref, r]));
  if (explicit) {
    const left = explicit.left;
    const right = explicit.right;
    const l = left.map((ref) => byRef.get(ref)).filter(Boolean) as CompareRun[];
    const r = right.map((ref) => byRef.get(ref)).filter(Boolean) as CompareRun[];
    if (!l.length || !r.length) return null;
    return {
      left,
      right,
      leftLabel: deriveCohortLabel(l, explicit.leftLabel),
      rightLabel: deriveCohortLabel(r, explicit.rightLabel),
      explicit: true,
      k: Math.min(left.length, right.length),
    };
  }
  const byModel = new Map<string, string[]>();
  for (const run of model.runs) {
    const name = String(run.run.model_name || '').trim();
    if (!name) return null;
    byModel.set(name, [...(byModel.get(name) ?? []), run.ref]);
  }
  if (byModel.size !== 2) return null;
  const [[lm, left], [rm, right]] = Array.from(byModel.entries()) as [[string, string[]], [string, string[]]];
  if (!left.length || left.length !== right.length) return null;
  return { left, right, leftLabel: lm, rightLabel: rm, explicit: false, k: left.length };
}

/** `Cohorts` as the URL carries them, with the expanded refs. */
export function cohortsToUrl(groups: CohortGroups): Cohorts {
  return {
    left: groups.left,
    right: groups.right,
    leftLabel: groups.leftLabel,
    rightLabel: groups.rightLabel,
  };
}

export type BucketKey = 'a_sweeps_b' | 'b_sweeps_a' | 'both_pass' | 'both_fail';
export const BUCKET_KEYS: BucketKey[] = ['a_sweeps_b', 'b_sweeps_a', 'both_pass', 'both_fail'];

export interface SweepItem {
  itemId: string;
  rawItemId: string;
  metadata: Record<string, unknown>;
  leftScores: number[];
  rightScores: number[];
  leftPasses: boolean[];
  rightPasses: boolean[];
  leftAttempts: number[];
  rightAttempts: number[];
  leftPassCount: number;
  rightPassCount: number;
  leftAvgAttempts: number;
  rightAvgAttempts: number;
  move: number;
  bucketKey: BucketKey | null;
}

export interface GroupedComparison {
  eligibleItems: number;
  leftRunCount: number;
  rightRunCount: number;
  k: number;
  items: SweepItem[];
  buckets: Record<BucketKey, { count: number; percentage: number; itemIds: string[] }>;
  reportK: number | null;
  direction: MetricDirection;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function collectSide(model: CompareModel, runs: CompareRun[], itemId: string, ctx: MetricCtx) {
  const scores: number[] = [];
  const passes: boolean[] = [];
  const attempts: number[] = [];
  const rows: Row[] = [];
  for (const run of runs) {
    const row = run.byItem.get(itemId);
    if (!row || run.metricIndex[ctx.metric] === undefined) return null;
    const outcome = runOutcome(run, itemId, ctx, model);
    if (!outcome || (outcome.score === null && !outcome.isError)) return null;
    if (outcome.score !== null) scores.push(outcome.score);
    passes.push(verdictOf(outcome, ctx) === true);
    attempts.push(Math.max(1, Number(row.retry_count || 0) + 1));
    rows.push(row);
  }
  return { scores, passes, attempts, rows };
}

export function computeGroupedComparison(
  model: CompareModel,
  groups: CohortGroups,
  ctx: MetricCtx,
): GroupedComparison {
  const empty = Object.fromEntries(
    BUCKET_KEYS.map((k) => [k, { count: 0, percentage: 0, itemIds: [] as string[] }]),
  ) as GroupedComparison['buckets'];
  const result: GroupedComparison = {
    eligibleItems: 0,
    leftRunCount: groups.left.length,
    rightRunCount: groups.right.length,
    k: groups.left.length,
    items: [],
    buckets: empty,
    reportK: null,
    direction: ctx.direction,
  };
  const byRef = new Map(model.runs.map((r) => [r.ref, r]));
  const left = groups.left.map((ref) => byRef.get(ref)).filter(Boolean) as CompareRun[];
  const right = groups.right.map((ref) => byRef.get(ref)).filter(Boolean) as CompareRun[];
  if (
    !left.length ||
    !right.length ||
    left.length !== groups.left.length ||
    right.length !== groups.right.length
  )
    return result;

  const reportKs = [...left, ...right].map(
    (r) => Number((r.run.config as Record<string, unknown> | undefined)?.report_k) || null,
  );
  result.reportK =
    reportKs.length && reportKs.every((v) => v && v === reportKs[0]) ? (reportKs[0] ?? null) : null;

  for (const itemId of model.itemIds) {
    const l = collectSide(model, left, itemId, ctx);
    const r = l ? collectSide(model, right, itemId, ctx) : null;
    if (!l || !r) continue;
    result.eligibleItems += 1;
    const lc = l.passes.filter(Boolean).length;
    const rc = r.passes.filter(Boolean).length;
    const rep = l.rows[0] ?? r.rows[0];
    const lAll = l.passes.every(Boolean);
    const lNone = l.passes.every((v) => !v);
    const rAll = r.passes.every(Boolean);
    const rNone = r.passes.every((v) => !v);
    let bucket: BucketKey | null = null;
    if (lAll && rNone) bucket = 'a_sweeps_b';
    else if (lNone && rAll) bucket = 'b_sweeps_a';
    else if (lAll && rAll) bucket = 'both_pass';
    else if (lNone && rNone) bucket = 'both_fail';
    result.items.push({
      itemId,
      rawItemId: rep?.item_id ?? '',
      metadata: (rep?.item_metadata as Record<string, unknown>) ?? {},
      leftScores: l.scores,
      rightScores: r.scores,
      leftPasses: l.passes,
      rightPasses: r.passes,
      leftAttempts: l.attempts,
      rightAttempts: r.attempts,
      leftPassCount: lc,
      rightPassCount: rc,
      leftAvgAttempts: avg(l.attempts),
      rightAvgAttempts: avg(r.attempts),
      move: rc - lc,
      bucketKey: bucket,
    });
    if (bucket) {
      result.buckets[bucket].count += 1;
      result.buckets[bucket].itemIds.push(itemId);
    }
  }
  for (const key of BUCKET_KEYS)
    result.buckets[key].percentage = result.eligibleItems
      ? result.buckets[key].count / result.eligibleItems
      : 0;
  result.items.sort(defaultSweepSort);
  return result;
}

export function defaultSweepSort(a: SweepItem, b: SweepItem): number {
  if (b.move !== a.move) return b.move - a.move;
  if (b.rightPassCount !== a.rightPassCount) return b.rightPassCount - a.rightPassCount;
  if (a.leftPassCount !== b.leftPassCount) return a.leftPassCount - b.leftPassCount;
  return String(a.itemId || a.rawItemId).localeCompare(String(b.itemId || b.rawItemId));
}

export interface SideSummary {
  passAtK: number;
  passHatK: number;
  avgAtK: number | null;
  consistency: number | null;
  reliability: number | null;
  avgAttempts: number;
}

export interface SweepSummary {
  eligibleItems: number;
  left: SideSummary;
  right: SideSummary;
  deltas: {
    passAtK: number;
    passHatK: number;
    avgAtK: number | null;
    consistency: number;
    reliability: number;
  };
  counts: {
    improved: number;
    regressed: number;
    unchanged: number;
    decisivelyFixed: number;
    decisivelyBroken: number;
    avgAttemptsDelta: number;
  };
  noise: NoiseReport | null;
  reportK: number | null;
}

function aggregateSide(
  items: SweepItem[],
  side: 'left' | 'right',
  runCount: number,
  reportK: number | null,
): SideSummary {
  let atK = 0;
  let hatK = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let consSum = 0;
  let consItems = 0;
  let relSum = 0;
  let relItems = 0;
  let attSum = 0;
  let attCount = 0;
  for (const item of items) {
    const passes = side === 'left' ? item.leftPasses : item.rightPasses;
    const scores = side === 'left' ? item.leftScores : item.rightScores;
    const attempts = side === 'left' ? item.leftAttempts : item.rightAttempts;
    const pc = passes.filter(Boolean).length;
    scoreSum += scores.reduce((s, v) => s + v, 0);
    scoreCount += scores.length;
    attSum += attempts.reduce((s, v) => s + v, 0);
    attCount += attempts.length;
    if (passes.length) {
      const kEff = reportK ? Math.min(reportK, passes.length) : passes.length;
      atK += passAtK(passes.length, pc, kEff) ?? 0;
      hatK += passHatK(passes.length, pc, kEff) ?? 0;
    }
    if (passes.length > 1) {
      consSum += (2 * Math.max(pc, passes.length - pc)) / passes.length - 1;
      consItems += 1;
    }
    if (pc > 0 && runCount > 0) {
      relSum += pc / runCount;
      relItems += 1;
    }
  }
  const n = items.length;
  return {
    passAtK: n ? atK / n : 0,
    passHatK: n ? hatK / n : 0,
    avgAtK: scoreCount ? scoreSum / scoreCount : null,
    consistency: consItems ? consSum / consItems : null,
    reliability: relItems ? relSum / relItems : null,
    avgAttempts: attCount ? attSum / attCount : 0,
  };
}

export function summarizeSweepItems(
  items: SweepItem[],
  leftRunCount: number,
  rightRunCount: number,
  reportK: number | null,
  direction: MetricDirection,
): SweepSummary {
  const left = aggregateSide(items, 'left', leftRunCount, reportK);
  const right = aggregateSide(items, 'right', rightRunCount, reportK);
  const counts = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    decisivelyFixed: 0,
    decisivelyBroken: 0,
    avgAttemptsDelta: 0,
  };
  let attemptsDelta = 0;
  for (const item of items) {
    if (item.move > 0) counts.improved += 1;
    else if (item.move < 0) counts.regressed += 1;
    else counts.unchanged += 1;
    attemptsDelta += item.rightAvgAttempts - item.leftAvgAttempts;
    if (item.leftPasses.length && item.rightPasses.length) {
      if (item.leftPasses.every((v) => !v) && item.rightPasses.every(Boolean)) counts.decisivelyFixed += 1;
      if (item.leftPasses.every(Boolean) && item.rightPasses.every((v) => !v)) counts.decisivelyBroken += 1;
    }
  }
  counts.avgAttemptsDelta = items.length ? attemptsDelta / items.length : 0;
  return {
    eligibleItems: items.length,
    left,
    right,
    deltas: {
      passAtK: right.passAtK - left.passAtK,
      passHatK: right.passHatK - left.passHatK,
      avgAtK: left.avgAtK === null || right.avgAtK === null ? null : right.avgAtK - left.avgAtK,
      consistency: (right.consistency ?? 0) - (left.consistency ?? 0),
      reliability: (right.reliability ?? 0) - (left.reliability ?? 0),
    },
    counts,
    noise: items.length ? computeSweepNoise(items, reportK, direction ?? 'maximize') : null,
    reportK,
  };
}

export function reverseSweepItem(item: SweepItem): SweepItem {
  return {
    ...item,
    leftScores: item.rightScores,
    rightScores: item.leftScores,
    leftPasses: item.rightPasses,
    rightPasses: item.leftPasses,
    leftAttempts: item.rightAttempts,
    rightAttempts: item.leftAttempts,
    leftPassCount: item.rightPassCount,
    rightPassCount: item.leftPassCount,
    leftAvgAttempts: item.rightAvgAttempts,
    rightAvgAttempts: item.leftAvgAttempts,
    move: -item.move,
    bucketKey:
      item.bucketKey === 'a_sweeps_b'
        ? 'b_sweeps_a'
        : item.bucketKey === 'b_sweeps_a'
          ? 'a_sweeps_b'
          : item.bucketKey,
  };
}

export type SweepOutcome =
  'all' | 'left_sweeps_right' | 'right_sweeps_left' | 'both_pass' | 'both_fail' | 'mixed';
export type SweepMove = 'all' | 'improved' | 'regressed' | 'unchanged';

export function sweepOutcomeOf(item: SweepItem): Exclude<SweepOutcome, 'all'> {
  if (!item.leftPasses.length || !item.rightPasses.length) return 'mixed';
  const lAll = item.leftPasses.every(Boolean);
  const lNone = item.leftPasses.every((v) => !v);
  const rAll = item.rightPasses.every(Boolean);
  const rNone = item.rightPasses.every((v) => !v);
  if (lAll && rNone) return 'left_sweeps_right';
  if (lNone && rAll) return 'right_sweeps_left';
  if (lAll && rAll) return 'both_pass';
  if (lNone && rNone) return 'both_fail';
  return 'mixed';
}

export interface SweepFilters {
  move: SweepMove;
  outcome: SweepOutcome;
  q: string;
  key: string;
  /** null = every value; [] = none. */
  values: string[] | null;
  mode: 'include' | 'exclude';
  /** Values that must be the sole value of a list-valued key. */
  only: string[];
}

export const DEFAULT_SWEEP_FILTERS: SweepFilters = {
  move: 'all',
  outcome: 'all',
  q: '',
  key: 'all',
  values: null,
  mode: 'include',
  only: [],
};

function matchesSweepSearch(item: SweepItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const md = item.metadata;
  const hay = [item.itemId, item.rawItemId, md.complexity, ...getMetadataCategoryValues(md, 'domain')]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => String(v).toLowerCase());
  return hay.some((v) => v.includes(q));
}

export function filterSweepItems(items: SweepItem[], f: SweepFilters): SweepItem[] {
  return items.filter((item) => {
    if (f.move === 'improved' && item.move <= 0) return false;
    if (f.move === 'regressed' && item.move >= 0) return false;
    if (f.move === 'unchanged' && item.move !== 0) return false;
    if (f.outcome !== 'all' && sweepOutcomeOf(item) !== f.outcome) return false;
    if (f.key !== 'all') {
      const values = getMetadataCategoryValues(item.metadata, f.key);
      if (!values.length) return false;
      if (f.mode === 'exclude') {
        if (f.values?.length && f.values.some((v) => values.includes(v))) return false;
      } else {
        if (f.values && f.values.length === 0) return false;
        if (f.values?.length && !f.values.some((v) => values.includes(v))) return false;
      }
      for (const only of f.only) if (values.includes(only) && values.length > 1) return false;
    }
    return matchesSweepSearch(item, f.q);
  });
}

export function sweepMetadataValues(items: SweepItem[], key: string): string[] {
  if (!key || key === 'all') return [];
  const set = new Set<string>();
  for (const item of items)
    for (const v of getMetadataCategoryValues(item.metadata, key)) if (v !== '') set.add(String(v));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function sweepKeySupportsOnly(items: SweepItem[], key: string): boolean {
  if (!key || key === 'all') return false;
  return isListCategoryKey(key) || items.some((i) => Array.isArray(i.metadata?.[key]));
}

/** Metadata keys usable in the breakdown (1..30 distinct values, internal keys left out). */
export function sweepMetadataKeys(items: SweepItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) for (const k of Object.keys(item.metadata ?? {})) keys.add(k);
  return Array.from(keys)
    .filter((k) => !SKIPPED_METADATA.has(k) && !k.startsWith('root_cause') && !k.startsWith('solution'))
    .filter((k) => {
      const n = sweepMetadataValues(items, k).length;
      return n >= 1 && n <= 30;
    })
    .sort();
}

/**
 * Whether a breakdown delta is good news. Avg@k is the metric's own value, so on a
 * minimize metric a drop is the improvement; pass-based columns are already "higher is better".
 */
export function breakdownDeltaGood(column: string, delta: number, direction: MetricDirection): number {
  return column === 'avgAtK' && direction === 'minimize' ? -delta : delta;
}
