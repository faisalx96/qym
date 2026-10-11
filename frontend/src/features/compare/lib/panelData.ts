/** Numbers of the analytics panel's Metrics tab: per column and metric, over the filtered items. */
import { isErrorRow } from '@/lib/metrics';
import { columnItemScores, compareWithBaseline, type BaselineStats, type MetricColumn } from './baseline';
import { columnItemLatencies } from './breakdown';
import type { CompareModel } from './model';
import { metricCtx } from './scoring';

export interface MetricCellData {
  mean: number | null;
  n: number;
  delta: BaselineStats | null;
}

export interface ColumnRow {
  column: MetricColumn;
  isBaseline: boolean;
  metrics: Record<string, MetricCellData>;
  latency: number | null;
  latencyRel: number | null;
  taskErrors: number;
  metricErrors: number;
}

export function buildColumnRows(
  model: CompareModel,
  columns: MetricColumn[],
  baseline: MetricColumn,
  itemIds: ReadonlySet<string>,
  thresholds: Record<string, number>,
): ColumnRow[] {
  const maps = new Map<string, Map<string, Map<string, number>>>();
  for (const metric of model.metrics) {
    const ctx = metricCtx(model, metric, thresholds);
    const byCol = new Map<string, Map<string, number>>();
    for (const col of columns) byCol.set(col.key, columnItemScores(model, col, ctx));
    maps.set(metric, byCol);
  }
  const lat = new Map(columns.map((c) => [c.key, columnItemLatencies(model, c)]));
  const meanOver = (m: Map<string, number>) => {
    let s = 0;
    let n = 0;
    m.forEach((v, id) => {
      if (itemIds.has(id)) {
        s += v;
        n += 1;
      }
    });
    return { mean: n ? s / n : null, n };
  };
  const baseLat = meanOver(lat.get(baseline.key) ?? new Map()).mean;
  return columns.map((column) => {
    const isBaseline = column.key === baseline.key;
    const metrics: Record<string, MetricCellData> = {};
    for (const metric of model.metrics) {
      const own = maps.get(metric)!.get(column.key)!;
      const base = maps.get(metric)!.get(baseline.key)!;
      const { mean, n } = meanOver(own);
      metrics[metric] = {
        mean,
        n,
        delta: isBaseline ? null : compareWithBaseline(own, base, { direction: model.directions[metric] ?? null }, itemIds),
      };
    }
    const l = meanOver(lat.get(column.key) ?? new Map()).mean;
    let task = 0;
    let scorer = 0;
    for (const ri of column.runIdxs) {
      const run = model.runs[ri];
      if (!run) continue;
      for (const [id, row] of run.byItem) {
        if (!itemIds.has(id)) continue;
        if (isErrorRow(row)) {
          if (row.status === 'error') task += 1;
          else scorer += 1;
        }
      }
    }
    return {
      column,
      isBaseline,
      metrics,
      latency: l,
      latencyRel: !isBaseline && l !== null && baseLat ? (l - baseLat) / baseLat : null,
      taskErrors: task,
      metricErrors: scorer,
    };
  });
}
