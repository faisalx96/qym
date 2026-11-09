import type { LiveSourceInfo } from '@/api/live';
import { toDate } from '@/lib/dates';
import { safeZone, zoneLabel, zoneTime, zoneToday } from './zone';

export function statusTime(timestamp: string, now: Date = new Date(), zone?: string): string {
  const date = toDate(timestamp);
  if (!date) return '—';
  const time = zoneTime(timestamp, zone);
  const day =
    zoneToday(zone, date) === zoneToday(zone, now)
      ? ''
      : `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: safeZone(zone) })} `;
  return `${day}${time} ${zoneLabel(zone)}`;
}

export function staleText(status: LiveSourceInfo, now: Date = new Date()): string {
  if (!status.last_heartbeat_at) return 'No heartbeat yet';
  const heartbeat = new Date(status.last_heartbeat_at);
  if (status.stale) {
    return `Worker not heard from since ${statusTime(status.last_heartbeat_at, now, status.day_key_timezone)}`;
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - heartbeat.getTime()) / 1000));
  return `last poll ${seconds} s ago`;
}
