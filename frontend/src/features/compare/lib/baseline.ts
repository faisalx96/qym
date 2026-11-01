/**
 * Per-Run Averages with a baseline (compare.html 10499-10760, brief 05 J3):
 * columns (a run, or each pass of a repeat run), the paired comparison of
 * every column against the baseline (mean difference over the items both
 * scored, 95% Student-t band, p-value, verdict) and improved/regressed counts.
 */
import {
  formatNumericValue,
  metricDeltaVerdict,
  type DeltaVerdict,
  type MetricDirection,
} from '@/lib/metrics';
import type { CompareModel } from './model';
import { tCritical, tTwoSidedP } from './tdist';
import { runOutcome, type MetricCtx } from './scoring';
import { passRefBase } from './refs';

export type PassColumns = 'run' | 'each';

export interface MetricColumn {
  /** Run id, or `<id>::pass<N>` for a single pass column. */
  key: string;
  base: string;
  runIdxs: number[];
  pass: number | null;
  label: string;
  title: string;
}

/** A repeat run is one column ("Run average") or one per pass ("Each pass"). */
export function metricColumns(model: CompareModel, mode: PassColumns): MetricColumn[] {
  const columns: MetricColumn[] = [];
  const byBase = new Map<string, MetricColumn>();
  model.runs.forEach((run, idx) => {
    if (run.pass && mode === 'run') {
      let col = byBase.get(run.base);
      if (!col) {
        col = {
          key: run.base,
          base: run.base,
          runIdxs: [],
          pass: null,
          label: run.run.pass_only
            ? String(run.run.base_run_name || baseLabel(run.title))
            : baseLabel(run.label),
          title: baseLabel(run.title),
        };
        byBase.set(run.base, col);
        columns.push(col);
      }
      col.runIdxs.push(idx);
      return;
    }
    columns.push({
      key: run.ref,
      base: run.base,
      runIdxs: [idx],
      pass: run.pass,
      label: run.label,
      title: run.title,
    });
  });
  return columns;
}

function baseLabel(label: string): string {
  return label.replace(/ · pass \d+$/, '');
}

function startedAt(run: { started_at?: string | null; created_at?: string | null }): number {
  const t = Date.parse(run.started_at ?? run.created_at ?? '');
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * The default baseline (K1, C036): the reference run of the set, as the run header picks it (C034): the latest
 * approved run, else the latest official run; else the run that started first. A repeat run starts at its first column.
 */
export function defaultBaselineKey(model: CompareModel, columns: MetricColumn[]): string | null {
  const runs = new Map<string, CompareModel['runs'][number]['run']>();
  for (const col of columns) {
    const run = model.runs[col.runIdxs[0] ?? 0]?.run;
    if (run && !runs.has(col.base)) runs.set(col.base, run);
  }
  const entries = Array.from(runs.entries());
  const latest = (list: typeof entries) =>
    list.reduce<(typeof entries)[number] | null>(
      (best, e) => (!best || startedAt(e[1]) > startedAt(best[1]) ? e : best),
      null,
    );
  const approved = latest(entries.filter(([, r]) => String(r.status).toUpperCase() === 'APPROVED'));
  const official = approved ? null : latest(entries.filter(([, r]) => r.origin === 'official'));
  const first = entries.reduce<(typeof entries)[number] | null>(
    (best, e) => (!best || startedAt(e[1]) < startedAt(best[1]) ? e : best),
    null,
  );
  const base = (approved ?? official ?? first)?.[0];
  return columns.find((c) => c.base === base)?.key ?? columns[0]?.key ?? null;
}

/** The chosen baseline, else the same run's first column, else the default (K1) when the model is given, else the first column. */
export function resolveBaseline(
  columns: MetricColumn[],
  key: string | null,
  model?: CompareModel,
): MetricColumn | null {
  if (key) {
    const exact = columns.find((c) => c.key === key);
    if (exact) return exact;
    const same = columns.find((c) => c.base === passRefBase(key));
    if (same) return same;
  }
  if (model) {
    const fallback = defaultBaselineKey(model, columns);
    const col = columns.find((c) => c.key === fallback);
    if (col) return col;
  }
  return columns[0] ?? null;
}

/** Mean score of each item in a column (a run-average column averages the item's passes). */
export function columnItemScores(
  model: CompareModel,
  column: MetricColumn,
  ctx: MetricCtx,
): Map<string, number> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const idx of column.runIdxs) {
    const run = model.runs[idx];
    if (!run || run.metricIndex[ctx.metric] === undefined) continue;
    for (const itemId of run.byItem.keys()) {
      const outcome = runOutcome(run, itemId, ctx, model);
      if (!outcome || outcome.score === null) continue;
      const e = sums.get(itemId) ?? { sum: 0, count: 0 };
      e.sum += outcome.score;
      e.count += 1;
      sums.set(itemId, e);
    }
  }
  const out = new Map<string, number>();
  sums.forEach((e, id) => out.set(id, e.sum / e.count));
  return out;
}

export type DeltaKind = 'improved' | 'regressed' | 'same';
export const DELTA_EPSILON = 1e-9;

export function deltaKind(delta: number, direction: MetricDirection): DeltaKind {
  if (Math.abs(delta) <= DELTA_EPSILON) return 'same';
  const better = direction === 'minimize' ? delta < 0 : delta > 0;
  return better ? 'improved' : 'regressed';
}

export interface BaselineStats {
  paired: number;
  counts: Record<DeltaKind, number>;
  mean: number | null;
  halfWidth: number | null;
  pValue: number | null;
  verdict: DeltaVerdict | null;
}

/**
 * Paired comparison on the items both columns scored, optionally limited to
 * some items. Band and p-value use Student's t with n-1 degrees of freedom.
 */
export function compareWithBaseline(
  scores: Map<string, number>,
  base: Map<string, number>,
  ctx: Pick<MetricCtx, 'direction'>,
  itemIds: ReadonlySet<string> | null = null,
): BaselineStats {
  const diffs: number[] = [];
  const counts: Record<DeltaKind, number> = { improved: 0, regressed: 0, same: 0 };
  scores.forEach((score, id) => {
    const b = base.get(id);
    if (b === undefined || (itemIds && !itemIds.has(id))) return;
    const delta = score - b;
    diffs.push(delta);
    counts[deltaKind(delta, ctx.direction)] += 1;
  });
  const n = diffs.length;
  const mean = n ? diffs.reduce((s, v) => s + v, 0) / n : null;
  let halfWidth: number | null = null;
  let pValue: number | null = null;
  if (n >= 2 && mean !== null) {
    const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const se = Math.sqrt(variance / n);
    halfWidth = tCritical(n - 1) * se;
    pValue = se > 0 ? tTwoSidedP(mean / se, n - 1) : mean === 0 ? 1 : 0;
  }
  const verdict =
    mean !== null && halfWidth !== null ? metricDeltaVerdict(mean, halfWidth, ctx.direction) : null;
  return { paired: n, counts, mean, halfWidth, pValue, verdict };
}

export function formatDelta(delta: number, type: string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const abs = Math.abs(delta);
  if (type === 'numeric') return sign + formatNumericValue(abs, abs < 1 ? 3 : 1);
  return `${sign}${(abs * 100).toFixed(1)} pts`;
}

/**
 * The change on an item chip (K3, C029): '▲ +8.4' (points for a score), '▼ −0.120' for a numeric metric, '≈ 0.0' for no
 * change. A boolean metric shows the glyph only.
 */
export function chipDelta(delta: number, type: string): string {
  const same = Math.abs(delta) <= DELTA_EPSILON;
  const glyph = same ? '≈' : delta > 0 ? '▲' : '▼';
  if (type === 'boolean') return glyph;
  if (same) return type === 'numeric' ? '≈ 0' : '≈ 0.0';
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  return `${glyph} ${sign}${type === 'numeric' ? formatNumericValue(abs, abs < 1 ? 3 : 1) : (abs * 100).toFixed(1)}`;
}

export function formatBand(halfWidth: number, type: string): string {
  if (type === 'numeric') return '±' + formatNumericValue(halfWidth, halfWidth < 1 ? 3 : 1);
  return '±' + (halfWidth * 100).toFixed(1);
}

export function kindLabel(kind: DeltaKind, direction: MetricDirection): string {
  if (!direction) return { improved: 'higher', regressed: 'lower', same: 'unchanged' }[kind];
  return kind === 'same' ? 'unchanged' : kind;
}
