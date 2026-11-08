import { APP_LOCALE, toDate } from '@/lib/dates';
import type { StatusShape, StatusTone } from '@/ui';

export function workerTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? `${date.toISOString().slice(11, 16)} UTC` : '—';
}

export function workerDay(value: string): string {
  const date = toDate(value);
  return date
    ? `${date.getUTCDate()} ${date.toLocaleDateString(APP_LOCALE, { month: 'short', timeZone: 'UTC' })}`
    : value;
}

/** The worker state as a StatusMark (B-11): running = blue orbit, paused = grey pause, any other = grey ring. */
export function workerStateMark(state: string): [StatusTone, StatusShape] {
  return state === 'running'
    ? ['info', 'orbit']
    : state === 'paused'
      ? ['neutral', 'pause']
      : ['neutral', 'ring'];
}
