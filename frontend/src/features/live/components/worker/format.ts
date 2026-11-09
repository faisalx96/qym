import { zoneLabel, zoneTime } from '../../lib/zone';
import { APP_LOCALE, toDate } from '@/lib/dates';

export function workerTime(value: string | null | undefined, zone?: string): string {
  const date = toDate(value);
  return date ? `${zoneTime(date.toISOString(), zone)} ${zoneLabel(zone)}` : '—';
}

export function workerDay(value: string): string {
  const date = toDate(value);
  return date
    ? `${date.getUTCDate()} ${date.toLocaleDateString(APP_LOCALE, { month: 'short', timeZone: 'UTC' })}`
    : value;
}
