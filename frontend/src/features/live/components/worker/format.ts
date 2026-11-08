import { formatShortDayKey, formatTableDate } from '@/lib/dates';
import type { StatusShape, StatusTone } from '@/ui';

export function workerTime(value: string | null | undefined): string {
  return formatTableDate(value);
}

export function workerDay(value: string): string {
  return formatShortDayKey(value);
}

/** The worker state as a StatusMark (B-11): running = blue orbit, paused = grey pause, any other = grey ring. */
export function workerStateMark(state: string): [StatusTone, StatusShape] {
  return state === 'running'
    ? ['info', 'orbit']
    : state === 'paused'
      ? ['neutral', 'pause']
      : ['neutral', 'ring'];
}
