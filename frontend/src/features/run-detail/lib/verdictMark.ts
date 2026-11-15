import type { StateTagTone } from '@/ui';

/**
 * An item outcome is the result of a check, so a StateTag tone (status rules 2026-11-12): Pass success, Fail and Error
 * danger, Not received warning, Running info. Any other kind (Pending, Done) is neutral: use `verdictTone`.
 */
export const VERDICT_MARK: Record<string, StateTagTone> = {
  pass: 'success',
  fail: 'danger',
  error: 'danger',
  not_received: 'warning',
  running: 'info',
};

/** The StateTag tone of an item outcome; an unknown kind is neutral. */
export function verdictTone(kind: string): StateTagTone {
  return VERDICT_MARK[kind] ?? 'neutral';
}
