import type { FeedbackEvent, FeedbackStatus } from '@/api/feedback';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dateTime(iso: string | null | undefined): string {
  return iso ? `${shortDate(iso)}, ${clock(iso)}` : '';
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
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
