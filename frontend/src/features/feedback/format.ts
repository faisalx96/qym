import type { FeedbackEvent, FeedbackStatus } from '@/api/feedback';
import { formatAgo, formatShortDay, formatTableDate, formatTime } from '@/lib/dates';

/** 'Sep 14' (lib/dates, C048). */
export function shortDate(iso: string | null | undefined): string {
  return formatShortDay(iso);
}

/** '19:05' (lib/dates). */
export function clock(iso: string | null | undefined): string {
  return formatTime(iso);
}

/** Table form 'Sep 14 · 19:05' (lib/dates). */
export function dateTime(iso: string | null | undefined): string {
  return iso ? formatTableDate(iso) : '';
}

/** Freshness, then the day (lib/dates). */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  return iso ? formatAgo(iso, now) : '';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function statusLabel(s: FeedbackStatus): string {
  return cap(s);
}

/** "Priority Low to Medium", "Marked as a duplicate of FB-0031" ... */
export function eventText(e: FeedbackEvent): string {
  const b = e.before as Record<string, string | null | undefined>;
  const a = e.after as Record<string, string | null | undefined>;
  switch (e.kind) {
    case 'submitted':
      return 'Submitted';
    case 'status':
      return `Status ${cap(String(b.status ?? ''))} to ${cap(String(a.status ?? ''))}`;
    case 'declined':
      return `Declined (was ${cap(String(b.status ?? ''))})`;
    case 'priority':
      return `Priority ${cap(String(b.priority ?? ''))} to ${cap(String(a.priority ?? ''))}`;
    case 'complexity':
      return `Complexity ${b.complexity ?? ''} to ${a.complexity ?? ''}`;
    case 'duplicate':
      return `Marked as a duplicate of ${a.duplicate_of ?? ''}`;
    case 'duplicate_cleared':
      return `Duplicate link to ${b.duplicate_of ?? ''} cleared`;
    default:
      return e.kind;
  }
}
