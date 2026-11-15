import { stringsOf } from './evidenceValues';
import type { LiveTurnDetail } from '@/api/live';
import { errorOf, numberOf, recordOf, servicesOf, stringOf } from './summary';
import { serviceEvidence } from './serviceEvidence';

export interface EvaluationProblem {
  text: string;
  tone: 'danger' | 'warning';
}

function problemText(value: unknown): string[] {
  const text = stringOf(value);
  if (text) return [text];
  if (Array.isArray(value)) return value.flatMap(problemText);
  const object = recordOf(value);
  return object
    ? Object.entries(object).flatMap(([key, item]) =>
        problemText(item).map((message) => `${key}: ${message}`),
      )
    : [];
}

export function evaluationProblems(data: LiveTurnDetail): EvaluationProblem[] {
  const s = data.summary;
  const meta = recordOf(s.eval_meta) ?? {};
  const problems: EvaluationProblem[] = [];
  const add = (text: string | null, tone: EvaluationProblem['tone'] = 'warning') => {
    if (text) problems.push({ text, tone });
  };
  add(errorOf(s), 'danger');
  if (s.evaluation_failed === true || data.turn.status === 'failed') add('Evaluation failed', 'danger');
  if (s.skipped === true || stringOf(s.skip_reason))
    add(`Skipped${stringOf(s.skip_reason) ? `: ${s.skip_reason}` : ''}`);
  if (stringOf(meta.error_type)) add(`Error type: ${meta.error_type}`, 'danger');
  if (meta.enrichment_failed === true) add('Question enrichment failed');
  problemText(meta.enrichment_errors).forEach((text) => add(`Enrichment: ${text}`));
  const dropped = numberOf(meta.viz_rows_dropped);
  if (dropped !== null && dropped > 0) add(`${dropped} visualization rows dropped`);
  const health = servicesOf(s).find((service) => service.name === 'eval_health');
  const failures = stringsOf(health?.signals?.component_failures);
  if (
    health &&
    (health.status === 'failed' ||
      health.status === 'degraded' ||
      health.status === 'skipped' ||
      failures.length)
  ) {
    add(
      `Evaluator health${health.status ? `: ${health.status}` : ''}${health.reason ? `. ${health.reason}` : ''}${serviceEvidence(health.signals) ? `. ${serviceEvidence(health.signals)}` : ''}`,
      health.status === 'failed' ? 'danger' : 'warning',
    );
  }
  if (s.detail_truncated === true) add('Evaluation detail was truncated');
  if (s.text_truncated === true) add('Evaluation text was truncated');
  stringsOf(data.turn.rejected).forEach((text) => add(`Rejected: ${text}`));
  return problems.filter(
    (problem, index) => problems.findIndex((other) => other.text === problem.text) === index,
  );
}

export function evaluationTiming(summary: Record<string, unknown>) {
  const meta = recordOf(summary.eval_meta);
  const raw = recordOf(meta?.stage_durations_s) ?? recordOf(meta?.durations_s);
  const values = Object.fromEntries(
    Object.entries(raw ?? {}).flatMap(([key, value]) => {
      const number = numberOf(value);
      return number !== null && number >= 0 ? [[key, number]] : [];
    }),
  );
  const labels: Record<string, string> = {
    enrichment: 'Enrichment',
    metrics: 'Metrics',
    judges: 'Judges',
    replay: 'Replay',
    manifest: 'Manifest (judges + replay)',
  };
  const parts = Object.entries(labels).flatMap(([key, label]) =>
    values[key] === undefined ? [] : [{ key, label, seconds: values[key]! }],
  );
  const known = parts.reduce((sum, part) => sum + part.seconds, 0);
  const unknown = Object.entries(values).reduce(
    (sum, [key, value]) => (key !== 'total' && !(key in labels) ? sum + value : sum),
    0,
  );
  const legacyMs = numberOf(recordOf(meta?.durations)?.evaluation_ms);
  const total =
    values.total ??
    (Object.keys(values).length
      ? known + unknown
      : legacyMs !== null && legacyMs >= 0
        ? legacyMs / 1000
        : null);
  const other = Math.max(unknown, (total ?? 0) - known);
  if (other > 0) parts.push({ key: 'other', label: 'Other', seconds: other });
  return { parts, total, scale: Math.max(total ?? 0, known + other) };
}
