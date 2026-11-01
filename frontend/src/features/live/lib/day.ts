/** Live days are worker UTC keys, independent of the browser's timezone. */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function isToday(day: string, now: Date = new Date()): boolean {
  return day === now.toISOString().slice(0, 10);
}

export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const label = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return isToday(day)
    ? `Today · ${label}`
    : `${date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${label}`;
}
