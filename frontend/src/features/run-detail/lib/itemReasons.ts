/**
 * Why an item failed a metric (item_reasons.js, C065). The first source that
 * exists wins: task error → scorer error → reason/error → explanation →
 * label → "Scored X, pass needs Y". Custom metadata keys are never parsed.
 */
export type ReasonKind =
  'task-error' | 'scorer-error' | 'reason' | 'verdict-error' | 'explanation' | 'label' | 'none';

export interface PickedReason {
  text: string;
  source: string;
  kind: ReasonKind;
}

export const REASON_ORDER = [
  { source: 'task error', detail: 'The item’s task failed (its error message)' },
  { source: 'scorer error', detail: 'The metric raised: status error, failed or timeout' },
  { source: 'reason', detail: 'meta.reason, or meta.error without an error status' },
  { source: 'explanation', detail: 'meta.explanation' },
  { source: 'label', detail: 'meta.label' },
  { source: 'no reason recorded', detail: 'The score and what a pass needs' },
];

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function scorerErrorStatus(meta: Record<string, unknown>): string {
  const status = String(meta.status ?? '')
    .trim()
    .toLowerCase();
  return status === 'error' || status === 'failed' || status === 'timeout' ? status : '';
}

export interface ReasonInput {
  taskError?: string | boolean | null;
  scorerError?: string | boolean | null;
  meta?: unknown;
  score?: string | null;
  need?: string | null;
}

export function pickReason(input: ReasonInput = {}): PickedReason {
  const meta =
    input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
      ? (input.meta as Record<string, unknown>)
      : {};
  if (input.taskError) {
    return {
      text: text(input.taskError === true ? '' : input.taskError) || 'Task execution failed',
      source: 'task error',
      kind: 'task-error',
    };
  }
  const status = scorerErrorStatus(meta);
  if (status || input.scorerError) {
    return {
      text:
        text(meta.error) ||
        text(input.scorerError === true ? '' : input.scorerError) ||
        'The scorer ended with status ' + (status || 'error'),
      source: 'scorer error',
      kind: 'scorer-error',
    };
  }
  const reason = text(meta.reason);
  if (reason) return { text: reason, source: 'reason', kind: 'reason' };
  const verdict = text(meta.error);
  if (verdict) return { text: verdict, source: 'reason', kind: 'verdict-error' };
  const explanation = text(meta.explanation);
  if (explanation) return { text: explanation, source: 'explanation', kind: 'explanation' };
  const label = text(meta.label);
  if (label) return { text: label, source: 'label', kind: 'label' };
  const scored =
    input.score !== undefined && input.score !== null && input.score !== '' ? String(input.score) : '—';
  return {
    text: 'Scored ' + scored + (input.need ? ', pass needs ' + input.need : ''),
    source: 'no reason recorded',
    kind: 'none',
  };
}

/** Whether the server may hold a better reason than the compact row (index drops explanations). */
export function needsServerReason(
  picked: PickedReason | null,
  metaKeys: string[] | null | undefined,
): boolean {
  if (!picked || picked.kind === 'task-error' || picked.kind === 'scorer-error' || picked.kind === 'reason')
    return false;
  const keys = Array.isArray(metaKeys) ? metaKeys : [];
  if (keys.includes('reason')) return true;
  if (picked.kind === 'verdict-error' || picked.kind === 'explanation') return false;
  return keys.includes('explanation');
}
