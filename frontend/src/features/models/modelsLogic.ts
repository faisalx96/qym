/** Pure logic of the Models page (dashboard.js models view, summary path). */
import type {
  ModelCandidate,
  ModelRun,
  ModelStats,
  StatGroup,
  TraceAverages,
  TraceKey,
} from '@/api/dashboardModels';
import { metricDirection, type MetricDirection, type MetricSpec } from '@/lib/metrics';

export type TimeRange = 'today' | '7d' | '30d' | 'all';
export type OriginFilter = 'all' | 'official' | 'local';
export type MetricKind = 'score' | 'numeric' | 'neutral';

export const MIN_K = 1;
export const MAX_K = 100;
export const DEFAULT_K = 5;

export function clampK(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_K;
  return Math.min(MAX_K, Math.max(MIN_K, n));
}

/** ISO lower bound of a time range, or undefined for "all". */
export function rangeSince(range: TimeRange, now = new Date()): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date(now);
  if (range === 'today') d.setHours(0, 0, 0, 0);
  else d.setTime(d.getTime() - (range === '7d' ? 7 : 30) * 86_400_000);
  return d.toISOString();
}

/** The spec's pass threshold, else 80% (maximize) or 20% (minimize). */
export function defaultPassThreshold(
  spec: (MetricSpec & { pass_threshold?: number | null }) | null | undefined,
  direction?: MetricDirection,
): number {
  const declared = spec?.pass_threshold;
  if (declared !== null && declared !== undefined && Number.isFinite(Number(declared)))
    return Number(declared);
  const resolved = direction === undefined ? metricDirection(spec) : direction;
  return resolved === 'minimize' ? 0.2 : 0.8;
}

export function metricKind(isNumeric: boolean, direction: MetricDirection): MetricKind {
  if (isNumeric) return 'numeric';
  return direction ? 'score' : 'neutral';
}

/** The pass slider only makes sense for directional, non-boolean, non-numeric metrics. */
export function showsThreshold(isBoolean: boolean, isNumeric: boolean, direction: MetricDirection): boolean {
  return !isBoolean && !isNumeric && direction !== null;
}

/** `name|||reasoning|plain` variant keys -> label and reasoning flag; provider prefix stripped. */
export function parseModelKey(key: string): { label: string; reasoning: boolean } {
  const marker = '|||';
  const idx = key.lastIndexOf(marker);
  let raw = key;
  let reasoning = false;
  if (idx >= 0) {
    const suffix = key.slice(idx + marker.length);
    if (suffix === 'reasoning' || suffix === 'plain') {
      raw = key.slice(0, idx);
      reasoning = suffix === 'reasoning';
    }
  }
  const slash = raw.lastIndexOf('/');
  return { label: (slash >= 0 ? raw.slice(slash + 1) : raw) || '—', reasoning };
}

/** Run ids counted for a model: its custom selection (that still exists), else the newest K. */
export function selectedRunIds(model: ModelCandidate, custom: string[] | undefined, k: number): string[] {
  const rows = model.rows ?? [];
  if (custom && custom.length) {
    const valid = new Set(rows.map((r) => r.run_id));
    return custom.filter((id) => valid.has(id)).slice(0, k);
  }
  return rows.slice(0, k).map((r) => r.run_id);
}

export function buildStatGroups(
  models: ModelCandidate[],
  custom: Record<string, string[]>,
  k: number,
): StatGroup[] {
  return models.map((m) => ({ key: m.model_key, runs: selectedRunIds(m, custom[m.model_key], k) }));
}

/** Best average first (direction-aware); models without an average last; ties by name. */
export function rankModels<T extends { key: string; avg: number | null }>(
  items: T[],
  direction: MetricDirection,
): T[] {
  return [...items].sort((a, b) => {
    if ((a.avg === null) !== (b.avg === null)) return a.avg === null ? 1 : -1;
    if (a.avg !== null && b.avg !== null && a.avg !== b.avg) {
      const better = direction === 'minimize' ? a.avg - b.avg : b.avg - a.avg;
      return better;
    }
    return a.key.localeCompare(b.key);
  });
}

/** Which metric to start on: the newest run's primary metric, else its first. */
export function defaultMetric(runs: ModelRun[], metrics: string[]): string {
  const newest = [...runs].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  if (newest) {
    const specs = newest.metric_specs ?? {};
    const primary = (newest.metrics ?? []).find((m) => specs[m]?.primary);
    if (primary && metrics.includes(primary)) return primary;
    const first = (newest.metrics ?? []).find((m) => metrics.includes(m));
    if (first) return first;
  }
  return metrics[0] ?? '';
}

/** Metrics in the newest run's spec order first, then the rest. */
export function orderMetrics(runs: ModelRun[], metrics: string[]): string[] {
  const newest = [...runs].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of newest)
    for (const m of r.metrics ?? [])
      if (metrics.includes(m) && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
  for (const m of metrics) if (!seen.has(m)) out.push(m);
  return out;
}

export interface StatTileDef {
  key: string;
  label: string;
  tip: string;
}

/** The stat tiles of a metric kind (dashboard.js l.6561-6594), in display order. */
export function statTiles(
  kind: MetricKind,
  k: number,
  direction: MetricDirection,
  thresholdPct: number,
  isBoolean: boolean,
  hasTrace = false,
): StatTileDef[] {
  const tiles = baseTiles(kind, k, direction, thresholdPct, isBoolean);
  return hasTrace ? [...tiles, ...TRACE_TILES] : tiles;
}

/** Trace tiles come from the runs' trace statistics (auto-derived from OTEL spans). */
export const TRACE_TILES: StatTileDef[] = [
  { key: 'trace:avg_tokens', label: 'Avg tokens', tip: "Average tokens per item, from the runs' traces." },
  {
    key: 'trace:avg_llm_calls',
    label: 'Avg LLM calls',
    tip: 'Average model calls per item, from the traces.',
  },
  {
    key: 'trace:avg_tool_calls',
    label: 'Avg tool calls',
    tip: 'Average tool calls per item, from the traces.',
  },
  {
    key: 'trace:tool_success_rate',
    label: 'Tool success rate',
    tip: 'Share of tool calls that succeeded, from the traces.',
  },
];

function baseTiles(
  kind: MetricKind,
  k: number,
  direction: MetricDirection,
  thresholdPct: number,
  isBoolean: boolean,
): StatTileDef[] {
  const rule = direction === 'minimize' ? '≤' : '≥';
  const best = direction === 'minimize' ? 'Min' : 'Max';
  const passText = isBoolean
    ? direction === 'minimize'
      ? 'the best score (0%)'
      : '100%'
    : `${rule}${thresholdPct}%`;
  const common: StatTileDef[] = [
    {
      key: 'failedCount',
      label: 'Errors',
      tip: 'Item evaluations that returned a task or scorer error across the selected runs.',
    },
    { key: 'totalRetries', label: 'Retries', tip: 'Total retries across all items in the selected runs.' },
    { key: 'avgLatency', label: 'Avg latency', tip: 'Average response time across all runs.' },
    {
      key: 'medianLatency',
      label: 'Median latency',
      tip: `Median response time across all items and all ${k} runs.`,
    },
  ];
  if (kind === 'neutral') {
    return [
      { key: 'avgScore', label: 'Avg', tip: `Mean value across all items and all ${k} runs.` },
      { key: 'minScore', label: 'Min', tip: 'Minimum value across all items and runs.' },
      { key: 'stddevScore', label: 'StdDev', tip: 'Standard deviation across all items and runs.' },
      ...common,
    ];
  }
  if (kind === 'numeric') {
    return [
      { key: 'avgScore', label: 'Avg', tip: `Mean value across all items and all ${k} runs.` },
      { key: 'minScore', label: 'Min', tip: 'Minimum value across all items and runs.' },
      {
        key: 'maxAtK',
        label: `${best}@${k}`,
        tip: `Average of the best value per item across all ${k} runs.`,
      },
      {
        key: 'stddevScore',
        label: 'StdDev',
        tip: 'Standard deviation across all items and runs. Lower is more consistent.',
      },
      { key: 'totalScoreSum', label: 'Total', tip: 'Sum of all values across all items and runs.' },
      ...common,
    ];
  }
  return [
    {
      key: 'passAtK',
      label: `Pass@${k}`,
      tip: `% of items where at least one of the ${k} runs reached ${passText}.`,
    },
    { key: 'passHatK', label: `Pass^${k}`, tip: `% of items where all ${k} runs reached ${passText}.` },
    { key: 'maxAtK', label: `${best}@${k}`, tip: `Average of the best score per item across all ${k} runs.` },
    {
      key: 'consistency',
      label: 'Consistency',
      tip: `How often runs agree on pass/fail across ${k} runs. 100% = all agree.`,
    },
    {
      key: 'reliability',
      label: 'Reliability',
      tip: 'When an item can be solved, how often is it? Only items with at least one passing run.',
    },
    { key: 'avgScore', label: 'Avg score', tip: `Mean score across all items and all ${k} runs.` },
    ...common,
  ];
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatTraceNumber(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v));
}

export function formatStat(
  key: string,
  stats: ModelStats & { totalRetries?: number; traceAverages?: TraceAverages },
  kind: MetricKind,
): string {
  if (key.startsWith('trace:')) {
    const name = key.slice(6) as TraceKey;
    const t = stats.traceAverages?.[name];
    if (t === undefined || !Number.isFinite(t)) return '—';
    if (name === 'tool_success_rate') return `${(t * 100).toFixed(1)}%`;
    return name === 'avg_tokens' ? formatTraceNumber(t) : t.toFixed(1);
  }
  const v = (stats as unknown as Record<string, number | null | undefined>)[key];
  if (key === 'failedCount' || key === 'totalRetries') return String(v ?? 0);
  if (key === 'avgLatency' || key === 'medianLatency') return formatLatency(v);
  if (v === null || v === undefined || !Number.isFinite(v))
    return key === 'consistency' || key === 'reliability' ? 'NA' : '—';
  if (kind === 'score') return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

export interface DistributionSegment {
  runs: number;
  count: number;
  share: number;
  tone: 'none' | 'some' | 'all';
}

/** Items by how many of the K runs got them right (0..K), skipping empty buckets. */
export function distributionSegments(dist: number[], k: number, totalItems: number): DistributionSegment[] {
  const total = totalItems || dist.reduce((a, b) => a + b, 0);
  if (!k || !total) return [];
  const out: DistributionSegment[] = [];
  for (let i = 0; i <= k; i++) {
    const count = dist[i] ?? 0;
    if (!count) continue;
    out.push({ runs: i, count, share: count / total, tone: i === 0 ? 'none' : i === k ? 'all' : 'some' });
  }
  return out;
}

/**
 * The options a filter leaves for a task or dataset select. A NONE selection or a single value (which is
 * just the select's own current pick, mirrored into the URL) leaves everything, so the select can switch;
 * two or more values (chosen in the Filters popover) narrow the options to those.
 */
export function scopedOptions(selected: string[], available: string[], none = '__none__'): string[] {
  if (selected.length < 2 || selected.includes(none)) return available;
  return available.filter((a) => selected.includes(a));
}

/** The single task or dataset in play: the one filtered to, else the only option, else none. */
export function chosenOption(selected: string[], options: string[]): string {
  if (selected.length === 1 && options.includes(selected[0]!)) return selected[0]!;
  return options.length === 1 ? options[0]! : '';
}

/** The filters of the Models page minus the task and dataset (those two come from the selects). */
export function withoutTaskAndDataset<T extends { tasks?: unknown; datasets?: unknown }>(
  filters: T,
): Omit<T, 'tasks' | 'datasets'> {
  const { tasks: _tasks, datasets: _datasets, ...rest } = filters;
  void _tasks;
  void _datasets;
  return rest;
}
