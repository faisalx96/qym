/**
 * Analyzer rows and the target filter. A pure port of analyzer.html
 * `analyzerRows()` and playground.js `_getMatchedItems()` so the footer count
 * and the target list match what the server's `_filter_analysis_targets`
 * will analyze (brief 08 §9 Q4).
 */
import { getRowScore, metricDirection, parseScoreValue } from '@/lib/metrics';
import type { CompactRow, MetricSpecInfo } from '@/api/analysis';

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export interface AnalyzerRow {
  item_id: string;
  index: number;
  input: unknown;
  input_full: unknown;
  expected: unknown;
  expected_full: unknown;
  output: unknown;
  output_full: unknown;
  error: string;
  item_metadata: Loose;
  metric_metadata_by_metric: Record<string, Loose>;
  metric_scores: Record<string, number | null>;
  metric_thresholds: Record<string, number>;
  metric_directions: Record<string, string>;
}

/** The one rule for every page (metrics.js isMetricErrorMeta): meta.status. */
export function isMetricErrorMeta(meta: unknown): boolean {
  if (!isObj(meta)) return false;
  const status = String(meta.status ?? '')
    .trim()
    .toLowerCase();
  return status === 'error' || status === 'failed' || status === 'timeout';
}

const ROW_ANALYSIS_KEYS = [
  'root_cause',
  'root_causes',
  'root_cause_categories',
  'root_cause_issues',
  'root_cause_detail',
  'root_cause_note',
  'root_cause_reason',
  'category_taxonomy',
  'root_cause_source',
  'root_cause_confidence',
  'solution',
  'solution_note',
  'solution_source',
  'analysis_error',
  'analysis_warning',
  'metric_analyses',
];

export interface BuildRowsInput {
  rows: CompactRow[];
  metricNames: string[];
  metricSpecs: Record<string, MetricSpecInfo>;
  /** Pass number for repeat runs, else null. */
  passNumber: number | null;
}

export function buildAnalyzerRows({ rows, metricNames, metricSpecs, passNumber }: BuildRowsInput): AnalyzerRow[] {
  return rows.map((row) => {
    const attempts = Array.isArray(row.pass_attempts) ? row.pass_attempts : [];
    const attempt =
      passNumber != null
        ? (attempts.find((a) => a && Number(a.pass_number) === passNumber) ?? attempts[passNumber - 1] ?? null)
        : null;

    const metricMeta: Record<string, Loose> = passNumber != null ? {} : (row.metric_meta ?? {});
    if (passNumber != null) {
      for (const [name, values] of Object.entries(row.pass_metric_meta ?? {})) {
        const value = Array.isArray(values) ? values[passNumber - 1] : null;
        if (isObj(value)) metricMeta[name] = value;
      }
    }

    let itemMetadata: Loose = isObj(row.item_metadata) ? row.item_metadata : {};
    if (passNumber != null) {
      const stripped: Loose = { ...itemMetadata };
      for (const key of ROW_ANALYSIS_KEYS) delete stripped[key];
      const analyses: Loose = {};
      for (const [name, values] of Object.entries(row.pass_metric_analyses ?? {})) {
        const analysis = Array.isArray(values) ? values[passNumber - 1] : null;
        if (isObj(analysis)) analyses[name] = analysis;
      }
      if (Object.keys(analyses).length) stripped.metric_analyses = analyses;
      itemMetadata = stripped;
    }

    const scores: Record<string, number | null> = {};
    const thresholds: Record<string, number> = {};
    const directions: Record<string, string> = {};
    metricNames.forEach((name, index) => {
      const passValues = row.pass_scores?.[name];
      const spec = metricSpecs[name];
      scores[name] =
        passNumber != null && Array.isArray(passValues)
          ? parseScoreValue(passValues[passNumber - 1])
          : getRowScore(row as never, index, name, metricDirection(spec)).score;
      thresholds[name] = spec?.pass_threshold != null ? Number(spec.pass_threshold) : 0.8;
      directions[name] = spec?.direction || 'maximize';
    });

    const useAttempt = passNumber != null && attempt;
    return {
      item_id: row.item_id,
      index: row.index,
      input: row.input != null ? row.input : row.input_preview,
      input_full: row.input_full,
      expected: row.expected,
      expected_full: row.expected_full,
      output: useAttempt ? attempt.output : row.output,
      output_full: useAttempt ? attempt.output : row.output_full,
      error: useAttempt ? String(attempt.error ?? '') : String(row.error ?? ''),
      item_metadata: itemMetadata,
      metric_metadata_by_metric: metricMeta,
      metric_scores: scores,
      metric_thresholds: thresholds,
      metric_directions: directions,
    };
  });
}

const isMinimize = (direction: string) => ['minimize', 'lower', 'lower_is_better'].includes(direction.toLowerCase());

export function isHumanMetricAnalysis(md: Loose | null | undefined, metricName: string): boolean {
  if (!md || typeof md !== 'object') return false;
  const analyses = isObj(md.metric_analyses) ? md.metric_analyses : {};
  const analysis = analyses[metricName];
  const source = isObj(analysis) ? (analysis.source ?? analysis.root_cause_source) : '';
  if (String(source ?? '').trim().toLowerCase() === 'human') return true;
  if (String(md.root_cause_source ?? '').trim().toLowerCase() !== 'human') return false;
  const legacyMetric = String(md.root_cause_metric_name ?? '').trim();
  return !legacyMetric || legacyMetric === String(metricName ?? '').trim();
}

export interface TargetOptions {
  selectedMetrics: string[];
  /** Max score as a fraction (0..1); applies only to maximize metrics. */
  maxScore: number;
  skipAnalyzed: boolean;
  allowHumanOverwrite: boolean;
  /** Fallback threshold when a metric declares none. */
  threshold?: number;
}

export interface MatchedTarget {
  row: AnalyzerRow;
  /** Failed metric names that remain after skip-analyzed / human rules. */
  metrics: string[];
}

export function matchTargets(rows: AnalyzerRow[], opts: TargetOptions): MatchedTarget[] {
  const threshold = opts.threshold ?? 0.8;
  const out: MatchedTarget[] = [];
  for (const row of rows) {
    if (row.error) continue; // task errors are operational, never analyzed
    const md = row.item_metadata;
    const analyses = isObj(md.metric_analyses) ? md.metric_analyses : {};
    let failed: string[] = [];
    for (const name of Object.keys(row.metric_scores)) {
      if (!opts.selectedMetrics.includes(name)) continue;
      if (isMetricErrorMeta(row.metric_metadata_by_metric[name])) continue;
      const score = row.metric_scores[name];
      const limit = row.metric_thresholds[name] ?? threshold;
      const direction = String(row.metric_directions[name] ?? 'maximize');
      const passed = score != null && (isMinimize(direction) ? score <= limit : score >= limit);
      if (!passed && (opts.allowHumanOverwrite || !isHumanMetricAnalysis(md, name))) failed.push(name);
    }
    if (opts.skipAnalyzed && failed.length) {
      failed = failed.filter((name) => {
        if (opts.allowHumanOverwrite && isHumanMetricAnalysis(md, name)) return true;
        const existing = analyses[name];
        return !(isObj(existing) && existing.root_cause);
      });
    }
    if (!failed.length) continue;
    if (!Number.isNaN(opts.maxScore)) {
      const hasWithinMax = failed.some((name) => {
        const score = row.metric_scores[name];
        return isMinimize(String(row.metric_directions[name] ?? 'maximize')) || score == null || score <= opts.maxScore;
      });
      if (!hasWithinMax) continue;
    }
    out.push({ row, metrics: failed });
  }
  return out;
}

export function humanOverwriteTargets(matched: MatchedTarget[]): Array<{ item_id: string; metric_name: string }> {
  const out: Array<{ item_id: string; metric_name: string }> = [];
  for (const { row, metrics } of matched) {
    for (const name of metrics) {
      if (isHumanMetricAnalysis(row.item_metadata, name)) out.push({ item_id: row.item_id, metric_name: name });
    }
  }
  return out;
}

/** Existing analysis (root causes) of one row+metric, for the target card chips. */
export function existingAnalysis(row: AnalyzerRow, metric: string): Loose | null {
  const analyses = isObj(row.item_metadata.metric_analyses) ? row.item_metadata.metric_analyses : {};
  const value = analyses[metric];
  return isObj(value) ? value : null;
}

/** The number of item-metric targets and items after the optional item limit. */
export function effectiveCount(matched: MatchedTarget[], limit: number | null): number {
  if (limit == null || limit < 1) return matched.length;
  return Math.min(limit, matched.length);
}
