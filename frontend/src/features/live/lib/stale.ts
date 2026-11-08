import type { LiveSourceInfo } from '@/api/live';
import { formatTableDate } from '@/lib/dates';

export function statusTime(timestamp: string, now: Date = new Date()): string {
  return formatTableDate(timestamp, now);
}

export function staleText(status: LiveSourceInfo, now: Date = new Date()): string {
  if (!status.last_heartbeat_at) return 'No heartbeat yet';
  const heartbeat = new Date(status.last_heartbeat_at);
  if (status.stale) {
    return `Worker not heard from since ${statusTime(status.last_heartbeat_at, now)}`;
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - heartbeat.getTime()) / 1000));
  return `last poll ${seconds} s ago`;
}
