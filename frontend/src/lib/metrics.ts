/**
 * Metric semantics, ported verbatim from the dashboard's metrics.js
 * (services/run_means.py is the server twin). Error handling is centralised
 * in getRowScore: task and scorer errors count as 0, except for
 * lower-is-better metrics, which leave them out of the mean (0 is their best
 * value) and never count them as a pass. A repeat row judges task errors per
 * pass, and an item never received is left out.
 */
export type MetricDirection = 'maximize' | 'minimize' | null;
export type MetricType = 'numeric' | 'boolean' | 'score' | 'legacy' | string;
export type ScoreBand = 1 | 2 | 3 | 4 | 5;

export interface MetricSpec {
  direction?: string | null;
  schema_version?: number | string | null;
  score_type?: string | null;
  primary?: boolean | null;
  pass_threshold?: number | string | null;
  unit?: string | null;
  precision?: number | null;
  sample_reducer?: string | null;
  run_reducer?: string | null;
}

export type MetricMeta = Record<string, unknown> | null | undefined;

/** The subset of a run row the metric layer reads. */
export interface MetricRow {
  status?: string | null;
  error?: unknown;
  task_error?: unknown;
  metric_values?: unknown[] | null;
  metric_meta?: Record<string, MetricMeta> | null;
  pass_scores?: Record<string, unknown[]> | null;
  pass_metric_meta?: Record<string, MetricMeta[]> | null;
  pass_attempts?: Array<{ status?: string | null } | null> | null;
  __pass_scope?: boolean;
}

export interface RowScore {
  score: number | null;
  isError: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isTaskErrorRow(
  row: { status?: string | null; task_error?: unknown } | null | undefined,
): boolean {
  if (!row) return false;
  const status = String(row.status ?? '').toLowerCase();
  return status === 'error' || status === 'failed' || !!row.task_error;
}

/** Only the explicit execution status the SDK sets for a raised metric. */
export function isMetricErrorMeta(meta: unknown): boolean {
  const obj = asObject(meta);
  if (!obj) return false;
  const status = String(obj.status ?? '')
    .trim()
    .toLowerCase();
  return status === 'error' || status === 'failed' || status === 'timeout';
}

export function metricMetaDisplayKey(key: string, meta: unknown): string {
  if (key !== 'error' || isMetricErrorMeta(meta)) return key;
  const obj = asObject(meta);
  const hasReason = !!obj && obj.reason !== undefined && obj.reason !== null && obj.reason !== '';
  return hasReason ? key : 'reason';
}

const INTERNAL_META_KEYS = new Set([
  'modified',
  'original_score',
  'original_score_numeric',
  'last_edit',
  'task_error',
]);
export function isInternalMetaKey(key: string): boolean {
  return INTERNAL_META_KEYS.has(key);
}

export function hasMetricError(row: MetricRow | null | undefined, metricName: string | null = null): boolean {
  if (!row) return false;
  const aggregateMeta = asObject(row.metric_meta) ?? {};
  const passMeta = asObject(row.pass_metric_meta) ?? {};
  const names =
    metricName === null
      ? Array.from(new Set([...Object.keys(aggregateMeta), ...Object.keys(passMeta)]))
      : [metricName];
  return names.some((name) => {
    const perPass = passMeta[name];
    if (Array.isArray(perPass) && perPass.some(isMetricErrorMeta)) return true;
    return isMetricErrorMeta(aggregateMeta[name]);
  });
}

export function isRepeatAggregateRow(row: MetricRow | null | undefined): boolean {
  return !!row && row.__pass_scope !== true && !!asObject(row.pass_scores);
}

export function isItemTaskError(row: MetricRow | null | undefined): boolean {
  return isTaskErrorRow(row) && !isRepeatAggregateRow(row);
}

export function isNotReceivedRow(row: { status?: string | null } | null | undefined): boolean {
  return !!row && String(row.status ?? '').toLowerCase() === 'not_received';
}

export function hasTaskError(row: MetricRow | null | undefined): boolean {
  if (!row) return false;
  if (!isRepeatAggregateRow(row)) return isTaskErrorRow(row);
  const attempts = Array.isArray(row.pass_attempts) ? row.pass_attempts : [];
  if (attempts.some((attempt) => !!attempt && isTaskErrorRow(attempt))) return true;
  const metas = asObject(row.pass_metric_meta) ?? {};
  return Object.keys(metas).some((name) => {
    const list = metas[name];
    return Array.isArray(list) && list.some((_, index) => isTaskErrorPass(row, name, index));
  });
}

export function isErrorRow(row: MetricRow | null | undefined): boolean {
  return hasTaskError(row) || hasMetricError(row);
}

export function parseScoreValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw = String(value).trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === 'n/a' || lowered === 'na' || lowered === 'none' || lowered === 'null') return null;
  if (raw === '✓' || lowered === 'true' || lowered === 'yes' || lowered === 'y') return 1;
  if (raw === '✗' || lowered === 'false' || lowered === 'no' || lowered === 'n') return 0;
  if (raw.endsWith('%')) {
    const pct = parseFloat(raw.slice(0, -1).trim());
    if (!Number.isNaN(pct)) return pct / 100;
  }
  const score = parseFloat(raw);
  return Number.isNaN(score) ? null : score;
}

export const SCORE_EDIT_HINTS: Record<string, string> = {
  boolean: 'Enter true or false (1 or 0).',
  percentage: 'Enter a value from 0 to 1, or 0% to 100%.',
  count: 'Enter a whole number, 0 or more.',
  number: 'Enter a number.',
  legacy: 'Enter a number.',
};

export type ScoreInputResult = { ok: true; value: number } | { ok: false; message: string };

/** Validate a manual score edit by the metric's spec type (services/score_edits.py). */
export function parseMetricScoreInput(
  raw: unknown,
  spec: MetricSpec | null | undefined,
  options: { reduced?: boolean } = {},
): ScoreInputResult {
  let scoreType = spec?.score_type ?? undefined;
  if (options.reduced) {
    scoreType =
      ({ boolean: 'percentage', count: 'number' } as Record<string, string>)[scoreType ?? ''] ?? scoreType;
  }
  const kind =
    scoreType && Object.prototype.hasOwnProperty.call(SCORE_EDIT_HINTS, scoreType) ? scoreType : 'legacy';
  const hint = SCORE_EDIT_HINTS[kind]!;
  const fail = (message: string): ScoreInputResult => ({ ok: false, message });
  const booleanWords = kind === 'boolean' || kind === 'legacy';
  let number: number;
  if (typeof raw === 'boolean') return booleanWords ? { ok: true, value: raw ? 1 : 0 } : fail(hint);
  if (typeof raw === 'number') number = raw;
  else if (typeof raw === 'string') {
    let text = raw.trim();
    if (!text) return fail('Enter a score. ' + hint);
    const lowered = text.toLowerCase();
    if (booleanWords && (lowered === 'true' || lowered === 'yes')) return { ok: true, value: 1 };
    if (booleanWords && (lowered === 'false' || lowered === 'no')) return { ok: true, value: 0 };
    const percent = text.endsWith('%');
    if (percent) {
      if (kind !== 'percentage' && kind !== 'legacy') return fail(hint);
      text = text.slice(0, -1).trim();
    }
    if (/^[+-]?[0-9]+,[0-9]+$/.test(text)) return fail('Use a dot for decimals (0.7, not 0,7).');
    if (!/^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text)) return fail(hint);
    number = Number(text) / (percent ? 100 : 1);
  } else return fail(hint);
  if (!Number.isFinite(number)) return fail(hint);
  if (kind === 'boolean' && number !== 0 && number !== 1) return fail(hint);
  if (kind === 'percentage' && !(number >= 0 && number <= 1)) return fail(hint);
  if (kind === 'count' && (number < 0 || !Number.isInteger(number))) return fail(hint);
  return { ok: true, value: number };
}

export function errorsLeftOut(direction: MetricDirection | undefined): boolean {
  return direction === 'minimize';
}

export function isTaskErrorPass(
  row: MetricRow | null | undefined,
  metricName: string,
  passIndex: number,
): boolean {
  const meta = asObject(row?.pass_metric_meta?.[metricName]?.[passIndex]);
  if (isMetricErrorMeta(meta)) return false;
  if (meta) {
    if (String(meta.modified ?? '').toLowerCase() === 'true') return false;
    if (
      String(meta.label ?? '')
        .trim()
        .toLowerCase() === 'error'
    ) {
      if (typeof meta.task_error === 'boolean') return meta.task_error;
      const others = Object.keys(meta).filter(
        (key) =>
          key !== 'label' &&
          key !== 'status' &&
          meta[key] !== null &&
          meta[key] !== undefined &&
          meta[key] !== '',
      );
      if (others.length === 0) return true;
    }
  }
  const attempt = Array.isArray(row?.pass_attempts) ? row!.pass_attempts![passIndex] : null;
  return !!attempt && isTaskErrorRow(attempt);
}

export function isItemEdit(meta: unknown): boolean {
  const obj = asObject(meta);
  return !!obj && String(obj.item_edit ?? '').toLowerCase() === 'true';
}

export function isReviewedPassSlice(row: MetricRow | null | undefined, metricName: string | null): boolean {
  if (!row || row.__pass_scope !== true || metricName === null || metricName === undefined) return false;
  const meta = asObject(asObject(row.metric_meta)?.[metricName]);
  return !!meta && String(meta.modified ?? '').toLowerCase() === 'true';
}

export interface PassOutcome {
  value: number | null;
  scorerError: boolean;
  taskError: boolean;
}

export function repeatPassOutcomes(
  row: MetricRow | null | undefined,
  metricName: string,
): PassOutcome[] | null {
  const scores = row?.pass_scores?.[metricName];
  if (!Array.isArray(scores)) return null;
  if (!asObject(row?.pass_metric_meta)) return null;
  const metas = row!.pass_metric_meta![metricName];
  return scores.map((raw, index) => {
    const scorerError = isMetricErrorMeta(Array.isArray(metas) ? metas[index] : null);
    return {
      value: parseScoreValue(raw),
      scorerError,
      taskError: !scorerError && isTaskErrorPass(row, metricName, index),
    };
  });
}

/** THE single source of truth for how errors enter a metric's mean. */
export function getRowScore(
  row: MetricRow | null | undefined,
  metricIdx: number,
  metricName: string | null = null,
  direction: MetricDirection = null,
): RowScore {
  if (!row || isNotReceivedRow(row)) return { score: null, isError: false };
  const leftOut = errorsLeftOut(direction);
  if (isItemTaskError(row) && !isReviewedPassSlice(row, metricName)) {
    return { score: leftOut ? null : 0, isError: true };
  }
  if (metricName !== null && isItemEdit(asObject(row.metric_meta)?.[metricName])) {
    return { score: parseScoreValue((row.metric_values ?? [])[metricIdx]), isError: false };
  }
  if (leftOut && metricName !== null) {
    const passes = repeatPassOutcomes(row, metricName);
    if (passes && passes.some((pass) => pass.scorerError || pass.taskError)) {
      let sum = 0;
      let count = 0;
      passes.forEach((pass) => {
        if (pass.scorerError || pass.taskError || pass.value === null) return;
        sum += pass.value;
        count++;
      });
      return { score: count ? sum / count : null, isError: true };
    }
    if (hasMetricError(row, metricName)) return { score: null, isError: true };
  }
  const metricError = metricName !== null && hasMetricError(row, metricName);
  const score = parseScoreValue((row.metric_values ?? [])[metricIdx]);
  if (score === null) return metricError ? { score: 0, isError: true } : { score: null, isError: false };
  return { score, isError: metricError };
}

export function rowMetricErrorCounts(
  row: MetricRow | null | undefined,
  metricName: string,
): { task: number; scorer: number } {
  if (!row || isNotReceivedRow(row)) return { task: 0, scorer: 0 };
  const passes = repeatPassOutcomes(row, metricName);
  if (passes) {
    const task = passes.filter((pass) => pass.taskError).length;
    const scorer = passes.filter((pass) => pass.scorerError).length;
    if (task || scorer || isRepeatAggregateRow(row)) return { task, scorer };
  }
  if (isRepeatAggregateRow(row)) {
    return { task: isTaskErrorRow(row) ? 1 : 0, scorer: hasMetricError(row, metricName) ? 1 : 0 };
  }
  if (isTaskErrorRow(row))
    return isReviewedPassSlice(row, metricName) ? { task: 0, scorer: 0 } : { task: 1, scorer: 0 };
  return { task: 0, scorer: hasMetricError(row, metricName) ? 1 : 0 };
}

export function rowMetricPasses(
  outcome: RowScore | null,
  threshold: number,
  direction: MetricDirection,
  isBoolean = false,
): boolean | null {
  if (direction !== 'maximize' && direction !== 'minimize') return null;
  if (outcome && outcome.isError && errorsLeftOut(direction)) return false;
  return metricPasses(outcome ? outcome.score : null, threshold, direction, isBoolean);
}

export function metricErrorRuleLabel(direction: MetricDirection): string {
  return errorsLeftOut(direction) ? 'not counted in the mean' : 'counted as 0%';
}

export function scoreWithoutMetricErrors(
  row: MetricRow,
  metricIdx: number,
  metricName: string,
  direction: MetricDirection = null,
): { score: number | null; errors: number } {
  if (errorsLeftOut(direction)) {
    const { score } = getRowScore(row, metricIdx, metricName, direction);
    return { score, errors: rowMetricErrorCounts(row, metricName).scorer };
  }
  const { score, isError } = getRowScore(row, metricIdx, metricName);
  if (score === null) return { score: null, errors: 0 };
  if (!isError || isItemTaskError(row)) return { score, errors: 0 };
  const passScores = row.pass_scores?.[metricName];
  const passMeta = row.pass_metric_meta?.[metricName];
  if (Array.isArray(passScores) && Array.isArray(passMeta) && passMeta.some(isMetricErrorMeta)) {
    let sum = 0;
    let count = 0;
    let errors = 0;
    passScores.forEach((raw, index) => {
      if (isMetricErrorMeta(passMeta[index])) {
        errors++;
        return;
      }
      const value = parseScoreValue(raw);
      if (value !== null) {
        sum += value;
        count++;
      }
    });
    return { score: count ? sum / count : null, errors };
  }
  return { score: null, errors: 1 };
}

export function calculateMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ── formatting ── */

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

export function formatLatency(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms >= 60000) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

export function scoreBand(score: number): ScoreBand {
  if (score >= 0.9) return 5;
  if (score >= 0.75) return 4;
  if (score >= 0.6) return 3;
  if (score >= 0.4) return 2;
  return 1;
}

export function getScoreColorClass(score: number): string {
  return `score-${scoreBand(score)}`;
}

/** '' for numeric metrics or metrics without a declared direction. */
export function getMetricColorClass(
  value: unknown,
  metricType: MetricType | undefined,
  direction: MetricDirection,
): string {
  if (metricType === 'numeric') return '';
  const n = parseScoreValue(value);
  if (n === null) return '';
  if (direction === 'maximize') return getScoreColorClass(n);
  if (direction === 'minimize') return getScoreColorClass(1 - n);
  return '';
}

export function metricBand(
  value: unknown,
  metricType: MetricType | undefined,
  direction: MetricDirection,
): ScoreBand | null {
  const cls = getMetricColorClass(value, metricType, direction);
  return cls ? (Number(cls.slice(-1)) as ScoreBand) : null;
}

export function detectMetricType(rows: MetricRow[], metricIdx: number): 'boolean' | 'score' | 'numeric' {
  let hasNonBinary = false;
  let hasOutOfRange = false;
  let count = 0;
  for (const row of rows) {
    const { score } = getRowScore(row, metricIdx);
    if (score === null) continue;
    count++;
    if (score !== 0 && score !== 1) hasNonBinary = true;
    if (score > 1 || score < 0) {
      hasOutOfRange = true;
      break;
    }
  }
  if (count === 0) return 'score';
  if (hasOutOfRange) return 'numeric';
  if (!hasNonBinary) return 'boolean';
  return 'score';
}

export function detectMetricTypeFromAvg(avgValue: number | null | undefined): 'score' | 'numeric' {
  if (avgValue === null || avgValue === undefined || Number.isNaN(avgValue)) return 'score';
  return avgValue > 1 || avgValue < 0 ? 'numeric' : 'score';
}

export function metricTypeFromSpec(
  spec: MetricSpec | null | undefined,
  fallbackValue?: number | null,
): MetricType {
  const scoreType = spec?.score_type;
  if (scoreType === 'boolean') return 'boolean';
  if (scoreType === 'percentage') return 'score';
  if (scoreType === 'count' || scoreType === 'number') return 'numeric';
  return detectMetricTypeFromAvg(fallbackValue);
}

export function formatMetricObservation(
  value: number | null | undefined,
  metricType: MetricType,
  spec?: MetricSpec | null,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (metricType === 'boolean') return Number(value) === 1 ? 'True' : 'False';
  const precision = spec && Number.isInteger(spec.precision) ? (spec.precision as number) : undefined;
  const formatted = formatMetricValue(value, metricType, precision);
  return spec?.unit && metricType === 'numeric' ? `${formatted} ${spec.unit}` : formatted;
}

export function formatMetricValue(
  value: number | null | undefined,
  metricType: MetricType,
  decimals?: number,
): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (metricType === 'numeric') return formatNumericValue(value);
  return formatPercent(value, decimals);
}

export function formatNumericValue(value: number | null | undefined, decimals = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (abs >= 10000) return (value / 1000).toFixed(1) + 'K';
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(decimals);
}

/* ── direction, default metric, thresholds ── */

export function metricDirection(spec: MetricSpec | null | undefined): MetricDirection {
  if (!spec || typeof spec !== 'object') return null;
  const direction = String(spec.direction ?? '')
    .trim()
    .toLowerCase();
  if (direction === 'minimize') return 'minimize';
  if (direction !== 'maximize') return null;
  const schemaVersion = Number(spec.schema_version) || 1;
  return spec.score_type === 'legacy' && schemaVersion < 2 ? null : 'maximize';
}

export function metricDirectionLabel(direction: MetricDirection): string {
  if (direction === 'maximize') return 'Higher is better';
  if (direction === 'minimize') return 'Lower is better';
  return 'No direction declared: shown without good/bad colors or verdicts';
}

export function defaultMetricName(
  metricNames: string[] | null | undefined,
  specs: Record<string, MetricSpec> | null | undefined,
): string | null {
  const names = Array.isArray(metricNames) ? metricNames.filter(Boolean) : [];
  const declared = names.find((name) => specs?.[name]?.primary === true);
  return declared ?? names[0] ?? null;
}

export function compareMetricValues(a: unknown, b: unknown, direction: MetricDirection): number {
  if (a === null || a === undefined || b === null || b === undefined) return 0;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return 0;
  if (direction === 'maximize') return x > y ? 1 : -1;
  if (direction === 'minimize') return x < y ? 1 : -1;
  return 0;
}

export function bestMetricIndexes(values: unknown[], direction: MetricDirection): number[] {
  if (direction !== 'maximize' && direction !== 'minimize') return [];
  let best: number | null = null;
  values.forEach((value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
    if (best === null || compareMetricValues(value, best, direction) > 0) best = Number(value);
  });
  if (best === null) return [];
  const out: number[] = [];
  values.forEach((value, index) => {
    if (value !== null && value !== undefined && Number(value) === best) out.push(index);
  });
  return out;
}

export function defaultPassThreshold(
  spec: MetricSpec | null | undefined,
  direction?: MetricDirection,
): number {
  const declared = spec?.pass_threshold;
  if (declared !== null && declared !== undefined && Number.isFinite(Number(declared)))
    return Number(declared);
  const resolved = direction === undefined ? metricDirection(spec) : direction;
  return resolved === 'minimize' ? 0.2 : 0.8;
}

export function metricPasses(
  value: unknown,
  threshold: number,
  direction: MetricDirection,
  isBoolean = false,
): boolean | null {
  if (direction !== 'maximize' && direction !== 'minimize') return null;
  if (value === null || value === undefined) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (isBoolean) return direction === 'minimize' ? v <= 0.0001 : v >= 0.9999;
  const t = Number(threshold);
  return direction === 'minimize' ? v <= t : v >= t;
}

export function passThresholdLabel(threshold: number, direction: MetricDirection): string {
  const pct = Math.round(Number(threshold) * 100);
  return (direction === 'minimize' ? '≤' : '≥') + pct + '%';
}

export type DeltaVerdict = 'improved' | 'regressed' | 'within_noise' | 'changed';
export function metricDeltaVerdict(delta: number, noise: number, direction: MetricDirection): DeltaVerdict {
  const d = Number(delta);
  const n = Math.max(0, Number(noise) || 0);
  if (!Number.isFinite(d) || Math.abs(d) <= n) return 'within_noise';
  if (direction === 'maximize') return d > 0 ? 'improved' : 'regressed';
  if (direction === 'minimize') return d < 0 ? 'improved' : 'regressed';
  return 'changed';
}
