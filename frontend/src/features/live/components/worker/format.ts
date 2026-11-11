import { APP_LOCALE, toDate } from '@/lib/dates';

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
