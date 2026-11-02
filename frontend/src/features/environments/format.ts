/** Small display helpers of the environments area. */
import { formatAgo, formatHeaderDate } from '@/lib/dates';

/** Freshness, then the day (lib/dates, C048). */
export function relTime(value: string | null | undefined, now = Date.now()): string {
  return value ? formatAgo(value, now) : '';
}

/** Header form (lib/dates, C048). */
export function absTime(value: string | null | undefined): string {
  return value ? formatHeaderDate(value) : '';
}

export const shortHash = (hash: string | null | undefined) => (hash ? String(hash).slice(0, 12) : '');

/** Mirrors HIGH_PRIORITY_WARNING in services/eval_priority.py (plan §5.3). */
export const highPriorityWarning = (envName: string) =>
  `Launching at HIGH cancels every running LOW/NORMAL job on ${envName} for all users.`;
