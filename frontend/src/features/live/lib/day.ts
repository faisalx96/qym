import { zoneToday } from './zone';

/** Live day keys are displayed as given, independent of the browser's timezone. */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function isToday(day: string, now: Date = new Date(), zone?: string): boolean {
  return day === zoneToday(zone, now);
}

export function dayLabel(day: string, zone?: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const label = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return isToday(day, new Date(), zone)
    ? `Today · ${label}`
    : `${date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${label}`;
}
