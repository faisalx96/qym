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
        delta: isBaseline
          ? null
          : compareWithBaseline(own, base, { direction: model.directions[metric] ?? null }, itemIds),
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

export type TraceFormat = 'count' | 'latency' | 'tokens' | 'percent';

export interface TraceRow {
  id: string;
  label: string;
  format: TraceFormat;
  /** One value per column; null = the run did not capture it (a dash, never 0). */
  values: Array<number | null>;
  best: 'low' | 'high';
}

const finite = (v: unknown): v is number => v != null && Number.isFinite(Number(v));
const positive = (v: unknown) => finite(v) && Number(v) > 0;

/**
 * Trace stat rows (tokens, LLM / tool / retriever / agent-span / evaluator latency) for the compared columns.
 * Empty unless some run has spans; a run's passes share its trace statistics.
 */
export function buildTraceRows(model: CompareModel, columns: MetricColumn[]): TraceRow[] {
  const stats = columns.map((c) => model.runs[c.runIdxs[0] ?? 0]?.run.trace_stats ?? null);
  if (!stats.some((s) => s?.has_spans)) return [];
  const hasLlm = stats.map((s) => !!s && (positive(s.avg_llm_calls) || positive(s.avg_tokens)));
  const hasTool = stats.map((s) => !!s && positive(s.avg_tool_calls));
  const num = (s: Record<string, unknown> | null, key: string, gate: boolean[] | null, i: number) => {
    if (!s || (gate && !gate[i])) return null;
    const v = s[key];
    return finite(v) && Number(v) >= 0 ? Number(v) : null;
  };
  const defs: Array<[string, string, TraceFormat, string, boolean[] | null, 'low' | 'high']> = [
    ['tokens', 'Avg tokens', 'tokens', 'avg_tokens', hasLlm, 'low'],
    ['llm-calls', 'Avg LLM calls', 'count', 'avg_llm_calls', hasLlm, 'low'],
    ['llm-ms', 'Avg LLM latency', 'latency', 'avg_llm_ms', hasLlm, 'low'],
    ['tool-calls', 'Avg tool calls', 'count', 'avg_tool_calls', hasTool, 'low'],
    ['tool-ms', 'Avg tool latency', 'latency', 'avg_tool_ms', hasTool, 'low'],
    ['tool-success', 'Tool success', 'percent', 'tool_success_rate', hasTool, 'high'],
    ['retriever-ms', 'Avg retriever latency', 'latency', 'avg_retriever_ms', null, 'low'],
    ['trace-ms', 'Avg trace latency', 'latency', 'avg_top_level_chain_ms', null, 'low'],
  ];
  const rows: TraceRow[] = defs.map(([id, label, format, key, gate, best]) => ({
    id,
    label,
    format,
    best,
    values: stats.map((s, i) => num(s as Record<string, unknown> | null, key, gate, i)),
  }));
  // One row per agent span name any compared run carries.
  const names: string[] = [];
  for (const s of stats) {
    const spans = Array.isArray(s?.outer_scope_parent_spans)
      ? (s!.outer_scope_parent_spans as Array<{ name?: string; avg_ms?: unknown }>)
      : [];
    for (const sp of spans)
      if (sp?.name && finite(sp.avg_ms) && !names.includes(sp.name)) names.push(sp.name);
  }
  for (const name of names) {
    rows.push({
      id: `agent:${name}`,
      label: `Avg ${name} latency`,
      format: 'latency',
      best: 'low',
      values: stats.map((s) => {
        const spans = Array.isArray(s?.outer_scope_parent_spans)
          ? (s!.outer_scope_parent_spans as Array<{ name?: string; avg_ms?: unknown }>)
          : [];
        const hit = spans.find((sp) => sp?.name === name && finite(sp.avg_ms));
        return hit ? Number(hit.avg_ms) : null;
      }),
    });
  }
  rows.push({
    id: 'evaluator-ms',
    label: 'Avg evaluator latency',
    format: 'latency',
    best: 'low',
    values: stats.map((s, i) => num(s as Record<string, unknown> | null, 'avg_evaluator_ms', null, i)),
  });
  return rows.filter((r) => r.values.some((v) => v !== null));
}
