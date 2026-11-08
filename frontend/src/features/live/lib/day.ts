import { formatDayKey } from '@/lib/dates';

/** Live days are calendar-day keys of the source (its day_key_timezone); they are never shifted to the browser zone. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** cv3-shim: remove after C-02 (today becomes the required source 'today' key; a Date or no value reads the old key). */
function todayKey(today: string | Date | undefined): string {
  return typeof today === 'string' ? today : (today ?? new Date()).toISOString().slice(0, 10);
}

export function isToday(day: string, today?: string | Date): boolean {
  return day === todayKey(today);
}

/** 'Today · Nov 7, 2026' or 'Thu Nov 5, 2026'. */
export function dayLabel(day: string, today?: string | Date): string {
  if (isToday(day, today)) return `Today · ${formatDayKey(day)}`;
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${formatDayKey(day)}`;
}
