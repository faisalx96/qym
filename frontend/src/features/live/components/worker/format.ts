import { formatShortDayKey, formatTableDate } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { humanizeKey } from '@/lib/humanizeKey';
import type { StateTagTone } from '@/ui';

export function workerTime(value: string | null | undefined): string {
  return formatTableDate(value);
}

export function workerDay(value: string): string {
  return formatShortDayKey(value);
}

/** A worker job kind as its word: Preview, Backfill, Re-evaluation; another kind by its own name. */
export function jobKindWord(kind: string | null | undefined): string {
  if (kind === 'backfill_preview') return 'Preview';
  if (kind === 'reevaluate') return 'Re-evaluation';
  return !kind || kind === 'backfill' ? 'Backfill' : humanizeKey(kind);
}

/** formatRelative falls back to an absolute date for reports older than a month. */
export function jobUpdateText(value: string, stale: boolean): string {
  const relative = formatRelative(value);
  if (!stale) return `updated ${relative}`;
  return relative.endsWith(' ago') ? `no update for ${relative.slice(0, -4)}` : `no update since ${relative}`;
}

/**
 * The worker state as a StateTag (B-11): running = info, paused or any other = neutral. The word is the state in
 * sentence case ('running' → 'Running'), with ` v<n>` when a settings version is given.
 */
export function workerStateTag(
  state: string,
  version?: number | null,
): { tone: StateTagTone; label: string } {
  return {
    tone: state === 'running' ? 'info' : 'neutral',
    label: `${humanizeKey(state)}${version != null ? ` v${version}` : ''}`,
  };
}
