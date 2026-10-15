/**
 * Overview, categories and deep-analysis math (run.html renderOverview,
 * computeScoreDistribution, getCategoryGroupStats, riPearson). Pure
 * functions over the filtered rows; every error-accounting rule goes
 * through metrics.ts.
 */
import {
  formatNumericValue,
  formatPercent,
  isErrorRow,
  isItemEdit,
  isItemTaskError,
  isNotReceivedRow,
  metricDirectionLabel,
  parseScoreValue,
  rowMetricErrorCounts,
  scoreWithoutMetricErrors,
  type MetricDirection,
  type MetricType,
} from '@/lib/metrics';
import type { Row } from '../types';
import { metricPassesFor, passValuesFor, rowScoreFor, type FilterContext } from './filterRules';
import {
  categoryValueText,
  getMetadataCategoryValues,
  HIDDEN_METADATA_KEYS,
  isListCategoryKey,
} from './rowMeta';

/* ── stat strip ── */

export interface RunCounts {
  total: number;
  completed: number;
  errors: number;
  notReceived: number;
}

export function runCounts(rows: Row[], repeatAggregate: boolean): RunCounts {
  const total = rows.length;
  const completed = rows.filter(
    (r) =>
      !isNotReceivedRow(r) &&
      (r.status === 'completed' || r.__has_output || r.output != null || r.output_full != null || !!r.error),
  ).length;
  const errors = rows.reduce((sum, row) => {
    const rowError = isErrorRow(row) ? 1 : 0;
    if (!repeatAggregate) return sum + rowError;
    const executionErrors = Number(row.execution_error_count);
    return sum + (Number.isFinite(executionErrors) ? Math.max(0, executionErrors) : rowError);
  }, 0);
  const notReceived = rows.filter((r) => isNotReceivedRow(r)).length;
  return { total, completed, errors, notReceived };
}

/* ── metric cards ── */

export interface ScoreBucket {
  index: number;
  label: string;
  min: number;
  max: number;
  count: number;
  scorerErrors: number;
  taskErrors: number;
  note: string;
}

export interface BoolSegment {
  key: 'passed' | 'failed' | 'true' | 'false' | 'metric_errors';
  label: string;
  count: number;
  title: string;
  tone: 'pass' | 'fail' | 'true' | 'false' | 'error';
}

export interface MetricCardModel {
  metric: string;
  type: MetricType;
  direction: MetricDirection;
  directionLabel: string;
  /** Mean over the scored rows (null when a lower-is-better metric had only errors). */
  avg: number | null;
  avgText: string;
  scoredCount: number;
  badge: string;
  errorNote: { text: string; title: string } | null;
  kind: 'score' | 'boolean' | 'numeric' | 'empty';
  numeric?: { min: number; max: number; sum: number };
  /** The item values the header mean averages over (errored items included as 0, or left out for lower-is-better metrics). */
  values: number[];
  buckets?: ScoreBucket[];
  segments?: BoolSegment[];
  segmentTotal?: number;
  errorLegend?: { pct: string; label: string; title: string } | null;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function metricCardModel(ctx: FilterContext, rows: Row[], metric: string): MetricCardModel | null {
  const { model, repeatAggregate: perPass } = ctx;
  const mIdx = model.metricNames.indexOf(metric);
  if (mIdx < 0) return null;
  const type = model.metricTypes[metric] ?? 'score';
  const direction = model.metricDirections[metric] ?? null;
  const leftOut = direction === 'minimize';
  let sum = 0;
  let cnt = 0;
  let min = Infinity;
  let max = -Infinity;
  let errCnt = 0;
  let taskErrCnt = 0;
  let errorRows = 0;
  let taskErrorRows = 0;
  let leftOutRows = 0;
  let cleanSum = 0;
  let cleanCnt = 0;
  const values: number[] = [];
  const errBuckets = new Array<number>(11).fill(0);
  const taskBuckets = new Array<number>(11).fill(0);
  const bucketOf = (score: number) => Math.min(10, Math.floor(Math.round(score * 100) / 10));
  for (const row of rows) {
    const { score, isError } = rowScoreFor(ctx, row, mIdx, metric);
    if (score !== null) {
      values.push(score);
      sum += score;
      cnt++;
      if (score < min) min = score;
      if (score > max) max = score;
    }
    if (leftOut) {
      if (!isError) continue;
      const counts = rowMetricErrorCounts(row, metric);
      errCnt += counts.scorer;
      taskErrCnt += counts.task;
      if (score === null) leftOutRows++;
      continue;
    }
    const clean = scoreWithoutMetricErrors(row, mIdx, metric);
    if (clean.score !== null) {
      cleanSum += clean.score;
      cleanCnt++;
    }
    if (score !== null && isError && !isItemTaskError(row)) {
      errCnt += perPass ? clean.errors : 1;
      errorRows++;
      errBuckets[bucketOf(score)]!++;
    }
    const taskErrors = score === null ? 0 : rowMetricErrorCounts(row, metric).task;
    if (taskErrors > 0) {
      taskErrCnt += perPass ? taskErrors : 1;
      if (isItemTaskError(row)) taskErrorRows++;
      taskBuckets[bucketOf(score as number)]!++;
    }
  }
  if (cnt === 0 && !(leftOut && errCnt + taskErrCnt > 0)) return null;
  const avg = cnt ? sum / cnt : null;

  let errorNote: MetricCardModel['errorNote'] = null;
  const kinds = [
    errCnt ? plural(errCnt, 'scorer error') : '',
    taskErrCnt ? plural(taskErrCnt, 'task error') : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const across = perPass ? ' across passes' : '';
  if (leftOut && errCnt + taskErrCnt > 0) {
    const n = errCnt + taskErrCnt;
    errorNote = {
      text: `${plural(n, 'error')}${across} · not counted in the mean`,
      title: `${kinds}${across} ${n === 1 ? 'is' : 'are'} not counted in this mean. Lower is better for ${metric}, so an error counted as 0 would read as its best score. They count as fails in pass rates.`,
    };
  } else if (!leftOut && errCnt + taskErrCnt > 0) {
    const numeric = type === 'numeric';
    const zero = numeric ? '0' : '0%';
    const unit = (n: number) => (perPass ? (n === 1 ? 'pass' : 'passes') : n === 1 ? 'item' : 'items');
    const fmtMean = numeric ? formatNumericValue : formatPercent;
    const total = errCnt + taskErrCnt;
    errorNote = {
      text: `${kinds}${across} · counted as ${zero}`,
      title: [
        errCnt ? `The ${metric} scorer failed on ${errCnt} ${unit(errCnt)}.` : '',
        taskErrCnt ? `The task failed on ${taskErrCnt} ${unit(taskErrCnt)}.` : '',
        `${total === 1 ? 'It counts' : 'They count'} as ${zero} in this mean${numeric ? ' and in Min.' : '.'}`,
        errCnt && cleanCnt > 0 ? `Mean without the scorer errors: ${fmtMean(cleanSum / cleanCnt)}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  const base = {
    metric,
    type,
    direction,
    directionLabel: metricDirectionLabel(direction),
    avg,
    scoredCount: cnt,
    errorNote,
    values,
  };
  if (avg === null) return { ...base, avgText: '—', badge: '0 scored', kind: 'empty' };

  if (type === 'numeric') {
    return {
      ...base,
      avgText: formatNumericValue(avg),
      badge: `${cnt} items`,
      kind: 'numeric',
      numeric: { min, max, sum },
    };
  }

  if (type === 'boolean') {
    let passCount = 0;
    let failCount = 0;
    let errorCount = 0;
    let taskErrorCount = 0;
    let cleanTrue = 0;
    let cleanCount = 0;
    for (const row of rows) {
      const { score, isError } = rowScoreFor(ctx, row, mIdx, metric);
      if (score === null && !isError) continue;
      if (isError) {
        errorCount++;
        if (isItemTaskError(row)) taskErrorCount++;
        continue;
      }
      cleanTrue += score as number;
      cleanCount++;
      const passed = metricPassesFor(ctx, metric, score);
      if (passed === true) passCount++;
      else if (passed === false) failCount++;
    }
    const trueCount = Math.round(cleanTrue);
    const falseCount = cleanCount - trueCount;
    const barTotal = cleanCount + errorCount;
    const segments: BoolSegment[] =
      direction === 'minimize'
        ? [
            {
              key: 'passed',
              label: 'Pass (False)',
              count: passCount,
              title: 'Click to filter passing items',
              tone: 'pass',
            },
            {
              key: 'failed',
              label: 'Fail (True)',
              count: failCount,
              title: 'Click to filter failing items',
              tone: 'fail',
            },
          ]
        : direction === 'maximize'
          ? [
              {
                key: 'passed',
                label: 'Pass',
                count: passCount,
                title: 'Click to filter passing items',
                tone: 'pass',
              },
              {
                key: 'failed',
                label: 'Fail',
                count: failCount,
                title: 'Click to filter failing items',
                tone: 'fail',
              },
            ]
          : [
              { key: 'true', label: 'True', count: trueCount, title: 'True', tone: 'true' },
              { key: 'false', label: 'False', count: falseCount, title: 'False', tone: 'false' },
            ];
    const scorerErrorCount = errorCount - taskErrorCount;
    const errorKinds = [
      scorerErrorCount ? plural(scorerErrorCount, 'scorer error') : '',
      taskErrorCount ? plural(taskErrorCount, 'task error') : '',
    ]
      .filter(Boolean)
      .join(', ');
    const errorTitle =
      direction === 'minimize'
        ? `${errorKinds}: not counted in the mean, since lower is better and an error would read as clean, and counted as fails. Click to filter them.`
        : `${errorKinds}: counted as False (0) in the mean${direction === 'maximize' ? ' and as fails' : ''}. Click to filter them.`;
    if (errorCount > 0)
      segments.push({
        key: 'metric_errors',
        label: 'Error',
        count: errorCount,
        title: errorTitle,
        tone: 'error',
      });
    return {
      ...base,
      avgText: formatPercent(avg),
      badge: `${barTotal} items`,
      kind: 'boolean',
      segments,
      segmentTotal: barTotal,
      errorLegend:
        errorCount > 0
          ? {
              pct: ((errorCount / barTotal) * 100).toFixed(0),
              label:
                direction === 'maximize'
                  ? 'counted as fail'
                  : direction === 'minimize'
                    ? 'not counted in the mean'
                    : 'counted as False',
              title: errorTitle,
            }
          : null,
    };
  }

  // score histogram
  const counts = new Array<number>(11).fill(0);
  for (const row of rows) {
    const { score } = rowScoreFor(ctx, row, mIdx, metric);
    if (score === null) continue;
    counts[Math.min(10, Math.floor(Math.round(score * 100) / 10))]!++;
  }
  const totalWithScores = counts.reduce((a, b) => a + b, 0);
  if (totalWithScores === 0) return null;
  const buckets: ScoreBucket[] = counts.map((count, b) => {
    const label = `${b * 10}%`;
    const errInBucket = Math.min(count, errBuckets[b]!);
    const taskInBucket = Math.min(count - errInBucket, taskBuckets[b]!);
    const note =
      (errInBucket > 0
        ? perPass
          ? ` (${errInBucket} with a failed scorer pass)`
          : ` (${plural(errInBucket, 'scorer error')}, counted as ${label})`
        : '') +
      (taskInBucket > 0
        ? perPass
          ? ` (${taskInBucket} with a failed task pass, counted as 0%)`
          : ` (${plural(taskInBucket, 'task error')}, counted as ${label})`
        : '');
    return {
      index: b,
      label,
      min: b / 10,
      max: b === 10 ? 1.01 : (b + 1) / 10,
      count,
      scorerErrors: errInBucket,
      taskErrors: taskInBucket,
      note,
    };
  });
  const badge = leftOut
    ? `${totalWithScores} scored${leftOutRows > 0 ? ` · ${leftOutRows} err` : ''}`
    : errorRows + taskErrorRows > 0
      ? `${totalWithScores - errorRows - taskErrorRows} scored · ${errorRows + taskErrorRows} err`
      : `${totalWithScores} scored`;
  return { ...base, avgText: formatPercent(avg), badge, kind: 'score', buckets };
}

/** Bucket colour token by position (getDistSegmentColor); neutral without a direction. */
export function bucketTone(bucketIdx: number, direction: MetricDirection): string {
  if (direction !== 'maximize' && direction !== 'minimize') return 'var(--chart-2)';
  const i = direction === 'minimize' ? 10 - bucketIdx : bucketIdx;
  const tones = [
    'var(--score-1)',
    'var(--score-1)',
    'var(--score-2)',
    'var(--score-2)',
    'var(--score-3)',
    'var(--score-3)',
    'var(--score-4)',
    'var(--score-4)',
    'var(--score-4)',
    'var(--score-5)',
    'var(--accent-primary)',
  ];
  return tones[Math.min(i, tones.length - 1)]!;
}

export function scoreTone(value: number, direction: MetricDirection): string {
  if (direction !== 'maximize' && direction !== 'minimize') return 'var(--chart-2)';
  const v = direction === 'minimize' ? 1 - value : value;
  if (v >= 0.9) return 'var(--score-5)';
  if (v >= 0.75) return 'var(--score-4)';
  if (v >= 0.6) return 'var(--score-3)';
  if (v >= 0.4) return 'var(--score-2)';
  return 'var(--score-1)';
}

/* ── categories ── */

export interface CategoryKey {
  key: string;
  count: number;
}

export function categoryChipKeys(rows: Row[], allMetadataKeys: string[], max = 30): CategoryKey[] {
  const keys: CategoryKey[] = [];
  for (const k of allMetadataKeys) {
    if (HIDDEN_METADATA_KEYS.has(k)) continue;
    const unique = new Set<string>();
    for (const row of rows) {
      const v = row.item_metadata?.[k];
      if (v != null && v !== '')
        getMetadataCategoryValues(row.item_metadata, k).forEach((x) => unique.add(x));
    }
    if (unique.size === 0 || unique.size > max) continue;
    keys.push({ key: k, count: unique.size });
  }
  return keys;
}

function categoryMetricScores(
  ctx: FilterContext,
  row: Row,
  metric: string,
  mIdx: number,
): { scores: number[]; errors: number } {
  if (!ctx.model.viewPass && row.pass_scores && Array.isArray(row.pass_scores[metric])) {
    let passes: { scores: number[]; errors: number } | null = null;
    if (ctx.model.metricDirections[metric] === 'minimize') {
      const values = passValuesFor(ctx, row, metric);
      const kept = values.filter((v): v is number => v !== null);
      const errors = values.length - kept.length;
      if (kept.length || errors) passes = { scores: kept, errors };
    } else {
      const values = row.pass_scores[metric]!.map((v) => parseScoreValue(v)).filter(
        (v): v is number => v !== null,
      );
      if (values.length) passes = { scores: values, errors: 0 };
    }
    if (passes && isItemEdit(row.metric_meta?.[metric])) {
      const { score } = rowScoreFor(ctx, row, mIdx, metric);
      const slots = passes.scores.length + passes.errors;
      return { scores: score === null ? [] : new Array<number>(slots).fill(score), errors: 0 };
    }
    if (passes) return passes;
  }
  const { score, isError } = rowScoreFor(ctx, row, mIdx, metric);
  if (score === null) return { scores: [], errors: isError ? 1 : 0 };
  return { scores: [score], errors: 0 };
}

export interface CategoryGroupStat {
  value: string;
  itemCount: number;
  avgScore: number | null;
  passRate: number | null;
  avgLatency: number | null;
}

export interface CategoryBreakdown {
  key: string;
  metric: string;
  overallAverage: number | null;
  groups: CategoryGroupStat[];
}

const COMPLEXITY_ORDER = ['easy', 'medium', 'hard', 'expert'];

export function categoryBreakdown(
  ctx: FilterContext,
  filteredRows: Row[],
  key: string,
  metric: string,
  domainFilter: string[] | null,
): CategoryBreakdown | null {
  const mIdx = ctx.model.metricNames.indexOf(metric);
  if (mIdx < 0) return null;
  const type = ctx.model.metricTypes[metric] ?? 'score';
  const supportsPassRate = type !== 'numeric' && !!ctx.model.metricDirections[metric];
  const overall: number[] = [];
  const groups = new Map<string, { scores: number[]; errors: number; latencies: number[]; count: number }>();
  const isListKey = isListCategoryKey(key);
  for (const row of filteredRows) {
    const metricScores = categoryMetricScores(ctx, row, metric, mIdx);
    overall.push(...metricScores.scores);
    const md = row.item_metadata ?? {};
    const parsed = getMetadataCategoryValues(md, key);
    const values = parsed.length ? parsed : [categoryValueText(md[key] ?? '')];
    const sole = isListKey && values.length === 1;
    for (const value of values) {
      if (
        isListKey &&
        domainFilter !== null &&
        domainFilter.some((f) => f.toLowerCase() === value.toLowerCase()) &&
        !sole
      )
        continue;
      const effective = value || 'unknown';
      let g = groups.get(effective);
      if (!g) groups.set(effective, (g = { scores: [], errors: 0, latencies: [], count: 0 }));
      g.count++;
      g.scores.push(...metricScores.scores);
      g.errors += metricScores.errors;
      if (row.latency_ms && row.status === 'completed') g.latencies.push(row.latency_ms);
    }
  }
  if (!overall.length) return null;
  const stats: CategoryGroupStat[] = [];
  groups.forEach((g, value) => {
    if (!g.scores.length && !g.errors) return;
    const passCount = supportsPassRate
      ? g.scores.filter((s) => metricPassesFor(ctx, metric, s) === true).length
      : 0;
    const entries = g.scores.length + g.errors;
    stats.push({
      value,
      itemCount: g.count,
      avgScore: g.scores.length ? g.scores.reduce((a, b) => a + b, 0) / g.scores.length : null,
      passRate: supportsPassRate && entries ? passCount / entries : null,
      avgLatency: g.latencies.length ? g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length : null,
    });
  });
  if (!stats.length) return null;
  if (key === 'complexity') {
    stats.sort((a, b) => {
      const ai = COMPLEXITY_ORDER.indexOf(a.value.toLowerCase());
      const bi = COMPLEXITY_ORDER.indexOf(b.value.toLowerCase());
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.value.localeCompare(b.value);
    });
  } else {
    stats.sort((a, b) => b.itemCount - a.itemCount || a.value.localeCompare(b.value));
  }
  return { key, metric, overallAverage: overall.reduce((a, b) => a + b, 0) / overall.length, groups: stats };
}

/** Best-to-worst distance of the group averages (0 when fewer than two groups have one). */
export function categorySpread(b: Pick<CategoryBreakdown, 'groups'>): number {
  const avgs = b.groups.map((g) => g.avgScore).filter((v): v is number => v !== null);
  return avgs.length < 2 ? 0 : Math.max(...avgs) - Math.min(...avgs);
}

export type CategorySort = 'worst' | 'best' | 'items' | 'name';

/** Groups ordered for the table. Worst/best follow the metric direction; groups without an average go last. */
export function sortCategoryGroups(
  groups: CategoryGroupStat[],
  sort: CategorySort,
  direction: 'maximize' | 'minimize' | null,
): CategoryGroupStat[] {
  const sign = (sort === 'worst') === (direction === 'minimize') ? -1 : 1;
  const out = groups.slice();
  if (sort === 'items')
    return out.sort((a, b) => b.itemCount - a.itemCount || a.value.localeCompare(b.value));
  if (sort === 'name') return out.sort((a, b) => a.value.localeCompare(b.value));
  return out.sort((a, b) => {
    if (a.avgScore === null && b.avgScore === null) return a.value.localeCompare(b.value);
    if (a.avgScore === null) return 1;
    if (b.avgScore === null) return -1;
    return sign * (a.avgScore - b.avgScore) || b.itemCount - a.itemCount;
  });
}

/** "Weakest: expert 25% (66 items, 24 pts below overall). Strongest: easy 80%." or null for fewer than two values. */
export function categoryInsight(
  b: CategoryBreakdown,
  direction: 'maximize' | 'minimize' | null,
  fmt: (v: number | null) => string,
  numeric: boolean,
): string | null {
  const scored = b.groups.filter((g) => g.avgScore !== null);
  if (scored.length < 2 || b.overallAverage === null) return null;
  const sorted = sortCategoryGroups(scored, 'worst', direction);
  const weakest = sorted[0]!;
  const strongest = sorted[sorted.length - 1]!;
  const gap = Math.abs((weakest.avgScore as number) - b.overallAverage);
  const gapText = numeric ? `${fmt(gap)}` : `${Math.round(gap * 100)} pts`;
  return `Weakest: ${weakest.value} ${fmt(weakest.avgScore)} (${weakest.itemCount} items, ${gapText} ${direction === 'minimize' ? 'above' : 'below'} overall). Strongest: ${strongest.value} ${fmt(strongest.avgScore)}.`;
}

/* ── deep analysis ── */

export function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export interface CorrelationMatrix {
  metrics: string[];
  /** r[i][j]; null when fewer than 3 matched items or no variance. */
  r: Array<Array<number | null>>;
  /** Per-item score vectors used for the scatter. */
  points: Array<{ itemId: string; scores: Array<number | null> }>;
}

export function correlationMatrix(ctx: FilterContext, rows: Row[]): CorrelationMatrix {
  const metrics = ctx.model.metricNames;
  const points = rows.map((row) => ({
    itemId: row.item_id,
    scores: metrics.map((m, i) => rowScoreFor(ctx, row, i, m).score),
  }));
  const r = metrics.map((_, i) =>
    metrics.map((_, j) => {
      if (i === j) return 1;
      const pairs: Array<[number, number]> = [];
      points.forEach((p) => {
        const a = p.scores[i];
        const b = p.scores[j];
        if (a !== null && b !== null && a !== undefined && b !== undefined) pairs.push([a, b]);
      });
      return pearson(pairs);
    }),
  );
  return { metrics, r, points };
}

/** The pair of distinct metrics with the strongest |r|. */
export function strongestPair(matrix: CorrelationMatrix): [number, number] | null {
  let best: [number, number] | null = null;
  let bestAbs = -1;
  for (let i = 0; i < matrix.metrics.length; i++) {
    for (let j = i + 1; j < matrix.metrics.length; j++) {
      const v = matrix.r[i]?.[j];
      if (v !== null && v !== undefined && Math.abs(v) > bestAbs) {
        bestAbs = Math.abs(v);
        best = [i, j];
      }
    }
  }
  return best ?? (matrix.metrics.length >= 2 ? [0, 1] : null);
}
