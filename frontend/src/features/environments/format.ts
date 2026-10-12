/** Small display helpers of the environments area. */

export function relTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '';
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return '';
  const seconds = Math.max(0, Math.floor((now - stamp.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function absTime(value: string | null | undefined): string {
  if (!value) return '';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleString();
}

export const shortHash = (hash: string | null | undefined) => (hash ? String(hash).slice(0, 12) : '');

/** Mirrors HIGH_PRIORITY_WARNING in services/eval_priority.py (plan §5.3). */
export const highPriorityWarning = (envName: string) =>
  `Launching at HIGH cancels every running LOW/NORMAL job on ${envName} for all users.`;
