import { zoneToday } from './zone';
import { formatDayKey } from '@/lib/dates';

/** Live days are calendar-day keys of the source (its day_key_timezone); they are never shifted to the browser zone. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** `today` is the source's own 'today' key. */
export function isToday(day: string, today: string | Date = new Date(), zone?: string): boolean {
  return day === (typeof today === 'string' ? today : zoneToday(zone, today));
}

/** 'Today · Nov 7, 2026' or 'Thu Nov 5, 2026'. */
export function dayLabel(day: string, todayOrZone: string): string {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayOrZone) ? todayOrZone : zoneToday(todayOrZone);
  if (isToday(day, today)) return `Today · ${formatDayKey(day)}`;
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${formatDayKey(day)}`;
}
