/**
 * `?pass=N`: every row is rewritten once so that downstream readers see one
 * pass's metric_values, output, latency, status and trace (run.html
 * scopeRowToPass). Scoped rows set `__pass_scope` so metrics.ts applies the
 * single-pass rules (isReviewedPassSlice) instead of the repeat-row rules.
 */
import type { MetricMeta } from '@/lib/metrics';
import type { MetricAnalysis, PassAttempt, Row } from '../types';

const ANALYSIS_KEYS = [
  'root_cause',
  'root_causes',
  'root_cause_categories',
  'root_cause_issues',
  'root_cause_detail',
  'root_cause_note',
  'root_cause_reason',
  'root_cause_source',
  'root_cause_confidence',
  'root_cause_metric_name',
  'solution',
  'solution_note',
  'solution_source',
  'metric_analyses',
  'analysis_error',
  'analysis_warning',
];

export function scopedPassAttempt(row: Row, passNumber: number): PassAttempt | null {
  const attempts = Array.isArray(row.pass_attempts) ? row.pass_attempts : [];
  const explicit = attempts.find((candidate) => candidate && Number(candidate.pass_number) === passNumber);
  if (explicit) return explicit;
  const positional = attempts[passNumber - 1];
  return positional && positional.pass_number == null ? positional : null;
}

function scopedPassMetricMeta(
  row: Row,
  metricNames: string[],
  passNumber: number,
): Record<string, MetricMeta> {
  const scoped: Record<string, MetricMeta> = {};
  const passMeta = row.pass_metric_meta ?? {};
  const aggregate = row.metric_meta ?? {};
  metricNames.forEach((name) => {
    const values = passMeta[name];
    if (Array.isArray(values)) {
      const value = values[passNumber - 1];
      if (value && typeof value === 'object') scoped[name] = value;
      return;
    }
    const fallback = aggregate[name];
    if (fallback && typeof fallback === 'object') scoped[name] = fallback;
  });
  return scoped;
}

function scopedPassItemMetadata(row: Row, metricNames: string[], passNumber: number): Row['item_metadata'] {
  const scoped: Record<string, unknown> = { ...(row.item_metadata ?? {}) };
  ANALYSIS_KEYS.forEach((key) => delete scoped[key]);
  const passAnalyses = row.pass_metric_analyses ?? {};
  const selected: Record<string, MetricAnalysis> = {};
  metricNames.forEach((name) => {
    const values = passAnalyses[name];
    const analysis = Array.isArray(values) ? values[passNumber - 1] : null;
    if (analysis && typeof analysis === 'object') selected[name] = analysis;
  });
  if (Object.keys(selected).length) scoped.metric_analyses = selected;
  return scoped as Row['item_metadata'];
}

export function scopeRowToPass(row: Row, metricNames: string[], passNumber: number): Row {
  const passValues = metricNames.map((name) => {
    const scores = row.pass_scores?.[name];
    return Array.isArray(scores) && scores.length >= passNumber ? scores[passNumber - 1] : null;
  });
  const att = scopedPassAttempt(row, passNumber);
  const hasPassScore = passValues.some((value) => value !== null && value !== undefined && value !== '');
  const rawStatus = String(att?.status ?? '').toLowerCase();
  const status =
    rawStatus === 'failed' || rawStatus === 'error'
      ? 'error'
      : rawStatus || (hasPassScore ? 'completed' : 'pending');
  const latencyMs = Number(att?.latency_ms ?? 0);
  const reviewCorrections: Row['review_corrections'] = {};
  const issueStatuses: Row['review_issue_statuses'] = {};
  const passAnalyses = row.pass_metric_analyses ?? {};
  metricNames.forEach((name) => {
    const values = passAnalyses[name];
    const analysis = Array.isArray(values) ? values[passNumber - 1] : null;
    if (!analysis || typeof analysis !== 'object') return;
    reviewCorrections[name] = { id: null, status: String(analysis.review_status ?? 'pending').toLowerCase() };
    const statuses = row.pass_review_issue_statuses?.[name];
    if (Array.isArray(statuses) && Array.isArray(statuses[passNumber - 1]))
      issueStatuses[name] = statuses[passNumber - 1]!;
  });
  return {
    ...row,
    metric_values: passValues,
    metric_meta: scopedPassMetricMeta(row, metricNames, passNumber),
    pass_metric_meta: undefined,
    item_metadata: scopedPassItemMetadata(row, metricNames, passNumber),
    review_correction_id: null,
    review_correction_status: '',
    review_corrections: reviewCorrections,
    review_issue_statuses: issueStatuses,
    status,
    error: att?.error ?? '',
    output: att ? (att.output ?? null) : null,
    output_full: att ? (att.output ?? null) : null,
    __has_output: !!(att && (att.__has_output || att.output != null)),
    __execution_error: att?.__execution_error ?? '',
    time: latencyMs > 0 ? (latencyMs / 1000).toFixed(3) : '',
    latency_ms: latencyMs,
    task_started_at_ms: att?.task_started_at_ms ?? null,
    retry_count: Number(att?.retry_count ?? 0),
    trace_id: att?.trace_id ?? '',
    trace_url: att?.trace_url ?? '',
    trace_stats: att?.trace_stats ?? null,
    _pass_has_attempt: !!att,
    __pass_scope: true,
  };
}

/** Pass summary inferred from scoped rows when /passes has not answered yet (processRun). */
export function inferPassSummary(
  rows: Row[],
  passNumber: number,
  lastCompletedPass: number,
  runStatus: string,
) {
  const starts = rows.map((r) => Number(r.task_started_at_ms)).filter((v) => Number.isFinite(v) && v > 0);
  const status =
    passNumber <= lastCompletedPass
      ? 'completed'
      : String(runStatus).toUpperCase() === 'RUNNING' && passNumber === lastCompletedPass + 1
        ? 'running'
        : 'pending';
  return {
    pass_number: passNumber,
    status,
    items_total: rows.length,
    items_started: rows.filter((r) => r.status !== 'pending').length,
    completed_count: rows.filter((r) => r.status === 'completed' || r.status === 'error').length,
    error_count: rows.filter((r) => r.status === 'error').length,
    running_count: rows.filter((r) => r.status === 'running').length,
    started_at: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
  };
}
