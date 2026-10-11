/** Pure metric semantics ported from metrics.js (score bands, direction). */
export type MetricDirection = 'maximize' | 'minimize' | null;
export type MetricType = 'numeric' | 'boolean' | 'score' | 'legacy' | string;
export type ScoreBand = 1 | 2 | 3 | 4 | 5;

export interface MetricSpec {
  direction?: string;
  schema_version?: number | string;
  score_type?: string;
  primary?: boolean;
}

export function parseScoreValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw = String(value).trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (['n/a', 'na', 'none', 'null', 'error', 'computing...'].includes(lowered)) return null;
  if (lowered === 'true' || lowered === '✓' || lowered === 'pass') return 1;
  if (lowered === 'false' || lowered === '✗' || lowered === 'fail') return 0;
  const pct = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(pct) ? pct : null;
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

export function errorsLeftOut(direction: MetricDirection): boolean {
  return direction === 'minimize';
}

export interface RowScore {
  score: number | null;
  isError: boolean;
}

/**
 * Minimal row scorer: a task error zeroes (maximize) or excludes (minimize)
 * the value; a metric error on this metric excludes it. The full repeat-pass
 * logic lives with the run-detail area (brief 04).
 */
export function getRowScore(
  row: {
    metric_values?: unknown[];
    task_error?: unknown;
    error?: unknown;
    metric_meta?: Record<string, { error?: unknown } | undefined>;
  } | null,
  metricIdx: number,
  metricName: string | null = null,
  direction: MetricDirection = null,
): RowScore {
  if (!row) return { score: null, isError: false };
  const leftOut = errorsLeftOut(direction);
  if (row.task_error || row.error) return { score: leftOut ? null : 0, isError: true };
  if (metricName && row.metric_meta?.[metricName]?.error) return { score: leftOut ? null : 0, isError: true };
  return { score: parseScoreValue((row.metric_values ?? [])[metricIdx]), isError: false };
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}
