/**
 * Pure Charts-page model (port of dashboard.js renderChartsView helpers):
 * card rows from a combo + its loaded history, grouping (run / version /
 * model / version→model / model→version), aggregates, sort keys, the
 * group-statistics rule and model colour index.
 */
import type { Combo, ComboModel, MetricType, RunRow } from '@/api/dashboardTypes';
import { metricDirection, type MetricDirection, type MetricSpec } from '@/lib/metrics';
import { compareModelKeys, parseModelKey, stripProvider } from '@/lib/runs-order';

export type GroupMode = 'run' | 'version' | 'model' | 'version-model' | 'model-version';
export type SortDir = 'asc' | 'desc';

export const GROUP_STAT_KEYS = {
  passAtK: '__group_pass_at_k__',
  consistency: '__group_consistency__',
  reliability: '__group_reliability__',
} as const;
export const GROUP_STAT_COLUMNS = [
  { key: GROUP_STAT_KEYS.passAtK, label: 'Pass@K' },
  { key: GROUP_STAT_KEYS.consistency, label: 'Consistency' },
  { key: GROUP_STAT_KEYS.reliability, label: 'Reliability' },
] as const;

export interface TraceMetricColumn {
  key: 'avg_tokens' | 'avg_llm_calls' | 'avg_tool_calls' | 'tool_success_rate';
  label: string;
  format: (v: number | null | undefined) => string;
}
function fmtTraceNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v));
}
export const TRACE_METRICS: TraceMetricColumn[] = [
  { key: 'avg_tokens', label: 'Avg Tokens', format: (v) => (v == null ? '—' : fmtTraceNum(v)) },
  { key: 'avg_llm_calls', label: 'Avg LLM Calls', format: (v) => (v == null ? '—' : v.toFixed(1)) },
  { key: 'avg_tool_calls', label: 'Avg Tool Calls', format: (v) => (v == null ? '—' : v.toFixed(1)) },
  { key: 'tool_success_rate', label: 'Tool Success Rate', format: (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`) },
];
export const SYSTEM_COLUMNS = [
  { key: 'latency', label: 'Avg Latency' },
  { key: 'median-latency', label: 'Median Latency' },
] as const;

export function isTraceMetricKey(key: string): key is TraceMetricColumn['key'] {
  return TRACE_METRICS.some((t) => t.key === key);
}

/** Trace columns that have at least one value in these rows. */
export function visibleTraceMetrics(rows: Pick<RunRow, 'trace_stats'>[]): TraceMetricColumn[] {
  return TRACE_METRICS.filter((t) => rows.some((r) => r.trace_stats?.[t.key] != null));
}

export function isLatencyLikeMetric(name: string): boolean {
  return /(^|[_\s-])latency([_\s-]|$)/i.test(name);
}
export function isTokenLikeMetric(name: string): boolean {
  return /(^|[_\s-])(token|tokens|usage)([_\s-]|$)/i.test(name);
}
/** Score metrics and latency/token-like numerics draw bars; other numerics are plain numbers. */
export function prefersBar(name: string, type: MetricType | undefined): boolean {
  if (type !== 'numeric') return true;
  return isLatencyLikeMetric(name) || isTokenLikeMetric(name);
}

/** A chart row: one run of a combo (lite row from /points). */
export interface ChartRun {
  run_id: string;
  run_name: string;
  model: string; // model_key
  timestamp: string;
  metric_averages: Record<string, number>;
  metric_specs: Record<string, MetricSpec>;
  metrics: string[];
  trace_stats: Record<string, unknown> | null;
  latency: number;
  median_latency: number;
  git_branch: string;
  git_commit: string;
  samples: number;
  status: string;
}

export function toChartRun(row: RunRow): ChartRun {
  return {
    run_id: row.run_id,
    run_name: row.run_name || row.external_run_id || row.run_id.slice(0, 8),
    model: row.model_key,
    timestamp: row.timestamp,
    metric_averages: row.metric_averages ?? {},
    metric_specs: row.metric_specs ?? {},
    metrics: row.metrics ?? [],
    trace_stats: row.trace_stats,
    latency: row.avg_latency_ms ?? 0,
    median_latency: row.median_latency_ms ?? 0,
    git_branch: row.git_branch ?? '',
    git_commit: row.git_commit ?? '',
    samples: row.samples ?? 1,
    status: row.status,
  };
}

export function comboHasVersionData(runs: Pick<ChartRun, 'git_commit'>[]): boolean {
  return runs.some((r) => Boolean(r.git_commit));
}

export function effectiveGroupMode(mode: GroupMode, hasVersions: boolean): GroupMode {
  if (!hasVersions && mode !== 'run' && mode !== 'model') return 'run';
  return mode;
}

export function defaultMetricName(names: string[], specs: Record<string, MetricSpec>): string | null {
  const list = names.filter(Boolean);
  return list.find((n) => specs[n]?.primary === true) ?? list[0] ?? null;
}

export function runsMetricDirection(runs: Pick<ChartRun, 'metric_specs'>[], metric: string): MetricDirection {
  const dirs = new Set<MetricDirection>();
  for (const r of runs) {
    const d = metricDirection(r.metric_specs[metric]);
    if (d) dirs.add(d);
  }
  return dirs.size === 1 ? [...dirs][0]! : null;
}

export function isGroupMetricBoolean(runs: Pick<ChartRun, 'metric_averages'>[], metric: string): boolean {
  let count = 0;
  for (const r of runs) {
    const v = r.metric_averages[metric];
    if (v === undefined || v === null || Number.isNaN(Number(v))) continue;
    count++;
    const n = Number(v);
    if (Math.abs(n) > 0.0001 && Math.abs(n - 1) > 0.0001) return false;
  }
  return count > 0;
}

export function defaultPassThreshold(spec: MetricSpec | undefined, direction: MetricDirection): number {
  const declared = (spec as { pass_threshold?: unknown } | undefined)?.pass_threshold;
  if (declared !== null && declared !== undefined && Number.isFinite(Number(declared))) return Number(declared);
  return direction === 'minimize' ? 0.2 : 0.8;
}

/** Group Pass@K metric: the newest run's declared primary if a score, else the first score metric. */
export function groupMetricName(runs: ChartRun[], comboMetrics: string[], types: Record<string, MetricType>): string {
  const isScore = (m: string) => (types[m] ?? 'score') !== 'numeric';
  const newest = [...runs].sort((a, b) => Date.parse(b.timestamp || '0') - Date.parse(a.timestamp || '0'))[0];
  const declared = newest ? defaultMetricName(newest.metrics, newest.metric_specs) : null;
  return (declared && comboMetrics.includes(declared) && isScore(declared) ? declared : comboMetrics.find(isScore)) ?? '';
}

export interface GroupStatRule {
  metric: string;
  threshold: number;
  is_boolean: boolean;
  direction: 'maximize' | 'minimize';
}

/** null when the metric declares no direction (pass rates need one, C008). */
export function groupStatRule(runs: ChartRun[], metric: string): GroupStatRule | null {
  if (!metric || !runs.length) return null;
  const direction = runsMetricDirection(runs, metric);
  if (!direction) return null;
  const isBoolean = isGroupMetricBoolean(runs, metric);
  const threshold = isBoolean ? 0.9999 : defaultPassThreshold(undefined, direction);
  return { metric, threshold, is_boolean: isBoolean, direction };
}

export interface GroupAgg {
  metricAverages: Record<string, number>;
  traceAverages: Record<string, number>;
  avgLatency: number | null;
  medianLatency: number | null;
}

export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeGroupAgg(runs: ChartRun[], metrics: string[], traceKeys: string[]): GroupAgg {
  const sums: Record<string, { sum: number; count: number }> = {};
  const traceSums: Record<string, { sum: number; count: number }> = {};
  let latSum = 0;
  let latCount = 0;
  const medians: number[] = [];
  for (const r of runs) {
    for (const m of metrics) {
      const v = r.metric_averages[m];
      if (v !== undefined && v !== null) {
        sums[m] ??= { sum: 0, count: 0 };
        sums[m].sum += v;
        sums[m].count++;
      }
    }
    for (const k of traceKeys) {
      const v = r.trace_stats?.[k];
      if (typeof v === 'number') {
        traceSums[k] ??= { sum: 0, count: 0 };
        traceSums[k].sum += v;
        traceSums[k].count++;
      }
    }
    if (r.latency) {
      latSum += r.latency;
      latCount++;
    }
    if (r.median_latency) medians.push(r.median_latency);
  }
  return {
    metricAverages: Object.fromEntries(Object.entries(sums).map(([m, s]) => [m, s.sum / s.count])),
    traceAverages: Object.fromEntries(Object.entries(traceSums).map(([m, s]) => [m, s.sum / s.count])),
    avgLatency: latCount ? latSum / latCount : null,
    medianLatency: medians.length ? median(medians) : null,
  };
}

export interface ChartGroup {
  id: string;
  key: string;
  label: string;
  kind: 'version' | 'model';
  model?: string;
  sortModel?: string;
  runs: ChartRun[];
  agg: GroupAgg;
  children?: ChartGroup[];
}

export function versionGroupOf(run: Pick<ChartRun, 'git_branch' | 'git_commit'>): { key: string; label: string } {
  if (run.git_commit) {
    return { key: run.git_commit, label: run.git_branch ? `${run.git_branch}/${run.git_commit}` : run.git_commit };
  }
  return { key: '__no_version__', label: 'No version' };
}

export function modelLabel(modelKey: string): string {
  const parsed = parseModelKey(modelKey);
  const name = stripProvider(parsed.name) || 'No model';
  return parsed.reasoning ? `${name} (reasoning)` : name;
}

function safeId(value: string): string {
  return (value || 'empty').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function groupRunsBy(
  runs: ChartRun[],
  kind: 'version' | 'model',
  metrics: string[],
  traceKeys: string[],
  idPrefix: string,
): ChartGroup[] {
  const groups = new Map<string, ChartGroup>();
  for (const r of runs) {
    const info =
      kind === 'version'
        ? { ...versionGroupOf(r), model: undefined, sortModel: undefined }
        : {
            key: r.model,
            label: modelLabel(r.model),
            model: r.model,
            sortModel: stripProvider(parseModelKey(r.model).name),
          };
    let g = groups.get(info.key);
    if (!g) {
      g = {
        id: `${idPrefix}_${kind === 'version' ? 'vg' : 'mg'}_${safeId(info.key)}`,
        key: info.key,
        label: info.label,
        kind,
        model: info.model,
        sortModel: info.sortModel,
        runs: [],
        agg: { metricAverages: {}, traceAverages: {}, avgLatency: null, medianLatency: null },
      };
      groups.set(info.key, g);
    }
    g.runs.push(r);
  }
  for (const g of groups.values()) g.agg = computeGroupAgg(g.runs, metrics, traceKeys);
  return [...groups.values()];
}

export function compareSortValues(a: unknown, b: unknown, dir: SortDir): number {
  const aMissing = a === undefined || a === null || a === '';
  const bMissing = b === undefined || b === null || b === '';
  if (aMissing || bMissing) return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
  if (typeof a === 'string' || typeof b === 'string') {
    const cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'desc' ? -cmp : cmp;
  }
  return dir === 'desc' ? (b as number) - (a as number) : (a as number) - (b as number);
}

export function runSortValue(run: ChartRun, key: string): unknown {
  if (key === 'model') return stripProvider(parseModelKey(run.model).name);
  if (key === 'latency') return run.latency || 0;
  if (key === 'median-latency') return run.median_latency || 0;
  if (isTraceMetricKey(key)) return (run.trace_stats?.[key] as number | undefined) ?? -1;
  return run.metric_averages[key] ?? -1;
}

export function groupSortValue(
  group: ChartGroup,
  key: string,
  stats?: { passAtK: number | null; consistency: number | null; reliability: number | null } | null,
): unknown {
  if (key === 'model') return group.sortModel ?? group.label;
  if (key === 'latency') return group.agg.avgLatency;
  if (key === 'median-latency') return group.agg.medianLatency;
  if (key === GROUP_STAT_KEYS.passAtK) return stats?.passAtK ?? -1;
  if (key === GROUP_STAT_KEYS.consistency) return stats?.consistency ?? -1;
  if (key === GROUP_STAT_KEYS.reliability) return stats?.reliability ?? -1;
  if (isTraceMetricKey(key)) return group.agg.traceAverages[key] ?? -1;
  return group.agg.metricAverages[key] ?? -1;
}

export function sortRuns(runs: ChartRun[], key: string, dir: SortDir): ChartRun[] {
  return [...runs].sort((a, b) => {
    const cmp = compareSortValues(runSortValue(a, key), runSortValue(b, key), dir);
    if (cmp !== 0) return cmp;
    if (key === 'model') return compareSortValues(a.timestamp || '', b.timestamp || '', 'desc');
    return 0;
  });
}

export function chartSortDirection(key: string): SortDir {
  return key === 'model' ? 'asc' : 'desc';
}

/** Build the (possibly nested) groups of a card. */
export function buildGroups(
  runs: ChartRun[],
  mode: GroupMode,
  metrics: string[],
  traceKeys: string[],
  cardId: string,
  sort: { key: string; dir: SortDir },
  statsOf: (group: ChartGroup) => { passAtK: number | null; consistency: number | null; reliability: number | null } | null | undefined,
): ChartGroup[] {
  if (mode === 'run') return [];
  const primary: 'version' | 'model' = mode === 'version' || mode === 'version-model' ? 'version' : 'model';
  const secondary: 'version' | 'model' | null =
    mode === 'version-model' ? 'model' : mode === 'model-version' ? 'version' : null;
  const sortGroups = (gs: ChartGroup[]) =>
    gs.sort((a, b) => compareSortValues(groupSortValue(a, sort.key, statsOf(a)), groupSortValue(b, sort.key, statsOf(b)), sort.dir));
  const groups = groupRunsBy(runs, primary, metrics, traceKeys, cardId);
  for (const g of groups) {
    if (secondary) {
      g.children = groupRunsBy(g.runs, secondary, metrics, traceKeys, g.id);
      for (const c of g.children) c.runs = sortRuns(c.runs, sort.key, sort.dir);
      sortGroups(g.children);
    } else g.runs = sortRuns(g.runs, sort.key, sort.dir);
  }
  return sortGroups(groups);
}

/** Flattened run list of a combo from the overview's chart_data (no history yet). */
export function comboRuns(combo: Combo): ChartRun[] {
  const out: ChartRun[] = [];
  for (const [model, data] of Object.entries(combo.models as Record<string, ComboModel>)) {
    for (const r of data.runsList ?? []) out.push({ ...toChartRun(r), model });
  }
  return out;
}

/** Stable model colour index: frequency order from the server (modelIndex), else by key. */
export function modelIndexOf(modelKey: string, index: Record<string, number>, palette: number): number {
  const i = index[modelKey];
  return (Number.isInteger(i) ? (i as number) : Object.keys(index).sort(compareModelKeys).indexOf(modelKey)) % palette;
}

export function firstColumnLabel(mode: GroupMode): string {
  return (
    { run: 'Model', version: 'Version', model: 'Model', 'version-model': 'Version / Model', 'model-version': 'Model / Version' }[
      mode
    ] ?? 'Model'
  );
}
