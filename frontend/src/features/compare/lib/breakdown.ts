/**
 * Aggregations over the filtered items: category breakdown, error
 * distribution and root-cause summary (compare.html compareCategoryRunGroups,
 * renderErrorDistributionSection, renderRootCauseSection; brief 05 J4/J5).
 * Counts follow the filtered item set; every column is a Per-Run Averages column.
 */
import type { Row } from '@/features/run-detail/types';
import { collectRowErrors, type ErrorBucket } from '@/features/run-detail/lib/rowErrors';
import { getMetadataCategoryValues, getRowRootCauseAnalyses, isListCategoryKey, rootCauseIssues } from '@/features/run-detail/lib/rowMeta';
import { columnItemScores, compareWithBaseline, type BaselineStats, type MetricColumn } from './baseline';
import type { CompareModel } from './model';
import type { MetricCtx } from './scoring';

export interface CategoryCell {
  score: number | null;
  latency: number | null;
  itemIds: Set<string>;
}

export interface CategoryGroup {
  value: string;
  itemIds: Set<string>;
  cells: CategoryCell[];
}

/** Mean latency per item in a column (completed executions with a latency). */
export function columnItemLatencies(model: CompareModel, column: MetricColumn): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const idx of column.runIdxs) {
    const run = model.runs[idx];
    if (!run) continue;
    for (const [id, row] of run.byItem) {
      if (!(row.latency_ms && row.status === 'completed')) continue;
      const e = sums.get(id) ?? { sum: 0, n: 0 };
      e.sum += row.latency_ms;
      e.n += 1;
      sums.set(id, e);
    }
  }
  const out = new Map<string, number>();
  sums.forEach((e, id) => out.set(id, e.sum / e.n));
  return out;
}

/** Metadata keys offered as category chips: 1..30 distinct values across the compared rows. */
const EXCLUDED = new Set([
  'root_cause', 'root_causes', 'root_cause_issues', 'root_cause_detail', 'root_cause_reason', 'root_cause_note',
  'root_cause_source', 'root_cause_confidence', 'solution', 'solution_note', 'solution_source',
  'task_started_at_ms', 'retry_count', 'analysis_error', 'trace_stats', 'metric_analyses',
]);

export function categoryKeys(model: CompareModel, itemIds: ReadonlySet<string>): Array<{ key: string; count: number }> {
  const values = new Map<string, Set<string>>();
  for (const run of model.runs)
    for (const [id, row] of run.byItem) {
      if (!itemIds.has(id)) continue;
      const md = row.item_metadata;
      if (!md || typeof md !== 'object') continue;
      for (const key of Object.keys(md)) {
        if (EXCLUDED.has(key)) continue;
        const vals = getMetadataCategoryValues(md, key);
        if (!vals.length) continue;
        const set = values.get(key) ?? new Set<string>();
        vals.forEach((v) => set.add(v));
        values.set(key, set);
      }
    }
  return Array.from(values.entries())
    .filter(([, set]) => set.size >= 1 && set.size <= 30)
    .map(([key, set]) => ({ key, count: set.size }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export const AUTO_CATEGORIES = 3;

export function categoryGroups(
  model: CompareModel,
  key: string,
  columns: MetricColumn[],
  itemIds: readonly string[],
  ctx: MetricCtx,
  domainFilter: string[] | null = null,
): CategoryGroup[] {
  const isList = isListCategoryKey(key);
  const groups = new Map<string, CategoryGroup>();
  const groupOf = (value: string) => {
    let g = groups.get(value);
    if (!g) {
      g = { value, itemIds: new Set(), cells: [] };
      groups.set(value, g);
    }
    return g;
  };
  const perColumn = new Map<string, Array<Set<string>>>();
  for (const itemId of itemIds) {
    columns.forEach((column, ci) =>
      column.runIdxs.forEach((ri) => {
        const row = model.runs[ri]?.byItem.get(itemId);
        if (!row) return;
        const values = getMetadataCategoryValues(row.item_metadata, key);
        if (!values.length) values.push('');
        const sole = values.length === 1;
        values.forEach((value) => {
          // A filtered domain shared by every item says nothing; its other domains still show.
          if (isList && domainFilter !== null && !sole && domainFilter.some((f) => f.toLowerCase() === value.toLowerCase())) return;
          const name = value || 'unknown';
          groupOf(name).itemIds.add(itemId);
          const sets = perColumn.get(name) ?? columns.map(() => new Set<string>());
          sets[ci]!.add(itemId);
          perColumn.set(name, sets);
        });
      }),
    );
  }
  const scores = columns.map((c) => columnItemScores(model, c, ctx));
  const lats = columns.map((c) => columnItemLatencies(model, c));
  const result: CategoryGroup[] = [];
  for (const g of groups.values()) {
    const sets = perColumn.get(g.value) ?? columns.map(() => new Set<string>());
    g.cells = columns.map((_, i) => {
      let s = 0;
      let n = 0;
      let l = 0;
      let ln = 0;
      sets[i]!.forEach((id) => {
        const sv = scores[i]!.get(id);
        if (sv !== undefined) {
          s += sv;
          n += 1;
        }
        const lv = lats[i]!.get(id);
        if (lv !== undefined) {
          l += lv;
          ln += 1;
        }
      });
      return { score: n ? s / n : null, latency: ln ? l / ln : null, itemIds: sets[i]! };
    });
    if (g.cells.some((c) => c.score !== null)) result.push(g);
  }
  const order = ['easy', 'medium', 'hard', 'expert'];
  const rank = (v: string) => {
    const i = order.indexOf(v.toLowerCase().trim());
    return i < 0 ? order.length : i;
  };
  return result.sort((a, b) =>
    key === 'complexity' && rank(a.value) !== rank(b.value)
      ? rank(a.value) - rank(b.value)
      : b.itemIds.size - a.itemIds.size || a.value.localeCompare(b.value, undefined, { numeric: true }),
  );
}

/** A category cell's change against the baseline over the items both put in the value. */
export function categoryDelta(
  model: CompareModel,
  column: MetricColumn,
  baseline: MetricColumn,
  ctx: MetricCtx,
  cell: CategoryCell,
  baseCell: CategoryCell,
): BaselineStats {
  const shared = new Set(Array.from(cell.itemIds).filter((id) => baseCell.itemIds.has(id)));
  return compareWithBaseline(columnItemScores(model, column, ctx), columnItemScores(model, baseline, ctx), ctx, shared);
}

/* ── errors ── */

export interface ErrorEntry {
  kind: ErrorBucket['kind'];
  label: string;
  counts: number[];
  count: number;
  details: Set<string>;
}

export function errorDistribution(
  model: CompareModel,
  columns: MetricColumn[],
  items: ReadonlyArray<{ itemId: string }>,
): ErrorEntry[] {
  const entries = new Map<string, ErrorEntry>();
  columns.forEach((column, ci) => {
    for (const item of items) {
      for (const ri of column.runIdxs) {
        const row = model.runs[ri]?.byItem.get(item.itemId);
        if (!row) continue;
        const buckets = new Map<string, ErrorBucket>();
        collectRowErrors(row, buckets, false);
        buckets.forEach((b, key) => {
          let e = entries.get(key);
          if (!e) {
            e = { kind: b.kind, label: b.label, counts: columns.map(() => 0), count: 0, details: new Set() };
            entries.set(key, e);
          }
          e.counts[ci] = (e.counts[ci] ?? 0) + b.count;
          e.count += b.count;
        });
      }
    }
  });
  return Array.from(entries.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/* ── root causes ── */

export interface RootCauseCategory {
  category: string;
  count: number;
  subcauses: Array<[string, number]>;
  /** Issue count per column. */
  counts: number[];
}

export function rootCauseSummary(
  model: CompareModel,
  columns: MetricColumn[],
  itemIds: ReadonlySet<string>,
  metric: string | 'all',
): RootCauseCategory[] {
  const cats = new Map<string, { count: number; sub: Map<string, number>; counts: number[] }>();
  columns.forEach((column, ci) =>
    column.runIdxs.forEach((ri) => {
      const run = model.runs[ri];
      if (!run) return;
      for (const [id, row] of run.byItem) {
        if (!itemIds.has(id)) continue;
        for (const analysis of getRowRootCauseAnalyses(row as Row, metric, false)) {
          for (const issue of rootCauseIssues(analysis)) {
            if (!issue.category) continue;
            const c = cats.get(issue.category) ?? { count: 0, sub: new Map<string, number>(), counts: columns.map(() => 0) };
            c.count += 1;
            c.counts[ci] = (c.counts[ci] ?? 0) + 1;
            if (issue.subcategory) c.sub.set(issue.subcategory, (c.sub.get(issue.subcategory) ?? 0) + 1);
            cats.set(issue.category, c);
          }
        }
      }
    }),
  );
  return Array.from(cats.entries())
    .map(([category, c]) => ({
      category,
      count: c.count,
      counts: c.counts,
      subcauses: Array.from(c.sub.entries()).sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.count - a.count);
}

export function hasAnyRootCause(model: CompareModel, itemIds: ReadonlySet<string>): boolean {
  return model.runs.some((run) =>
    Array.from(run.byItem).some(([id, row]) => itemIds.has(id) && getRowRootCauseAnalyses(row as Row, 'all', false).some((a) => rootCauseIssues(a).length)),
  );
}
