import { formatShortDayKey, formatTableDate } from '@/lib/dates';
import { humanizeKey } from '@/lib/humanizeKey';
import type { StateTagTone } from '@/ui';

export function workerTime(value: string | null | undefined): string {
  return formatTableDate(value);
}

export function workerDay(value: string): string {
  return formatShortDayKey(value);
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
