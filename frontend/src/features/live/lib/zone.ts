import { toDate } from '@/lib/dates';

export function safeZone(zone?: string | null): string {
  if (!zone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

function parts(date: Date, zone?: string | null) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: safeZone(zone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
}

export function zoneToday(zone?: string | null, now: Date = new Date()): string {
  const { year, month, day } = parts(now, zone);
  return `${year}-${month}-${day}`;
}

export function zoneTime(iso: string, zone?: string | null): string {
  const date = toDate(iso);
  if (!date) return '—';
  const { hour, minute } = parts(date, zone);
  return `${hour}:${minute}`;
}

export function zoneDateTime(iso: string, zone?: string | null, includeSeconds = false): string {
  const date = toDate(iso);
  if (!date) return '—';
  const { year, month, day, hour, minute, second } = parts(date, zone);
  return `${year}-${month}-${day} ${hour}:${minute}${includeSeconds ? `:${second}` : ''}`;
}

export function zoneLabel(zone?: string | null): string {
  const name = safeZone(zone);
  if (['Etc/UTC', 'Etc/Universal', 'Etc/Zulu'].includes(name)) return 'UTC';
  if (name.startsWith('Etc/')) return name;
  return name.split('/').at(-1)!.replaceAll('_', ' ');
}
