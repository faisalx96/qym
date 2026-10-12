import { useMemo } from 'react';
import { columnItemScores, compareWithBaseline, metricColumns, resolveBaseline, type BaselineStats, type MetricColumn } from '../lib/baseline';
import type { CompareModel } from '../lib/model';
import type { MetricCtx } from '../lib/scoring';
import type { CompareView } from '../lib/filters';

export interface ColumnsInfo {
  columns: MetricColumn[];
  baseline: MetricColumn;
}

export function useColumns(model: CompareModel | null, view: CompareView): ColumnsInfo | null {
  return useMemo(() => {
    if (!model) return null;
    const columns = metricColumns(model, view.columns);
    const baseline = resolveBaseline(columns, view.baseline);
    return baseline ? { columns, baseline } : null;
  }, [model, view.columns, view.baseline]);
}

/** Paired stats of every column vs the baseline on one metric, over all items. */
export function useColumnStats(model: CompareModel, info: ColumnsInfo, ctx: MetricCtx): Map<string, BaselineStats> {
  return useMemo(() => {
    const base = columnItemScores(model, info.baseline, ctx);
    const out = new Map<string, BaselineStats>();
    for (const col of info.columns) {
      if (col.key === info.baseline.key) continue;
      out.set(col.key, compareWithBaseline(columnItemScores(model, col, ctx), base, ctx));
    }
    return out;
  }, [model, info, ctx]);
}
