import type { LiveSourceInfo } from '@/api/live';
import { formatAgo, formatTableDate } from '@/lib/dates';

export function statusTime(timestamp: string, now: Date = new Date()): string {
  return formatTableDate(timestamp, now);
}

export function staleText(status: LiveSourceInfo, now: Date = new Date()): string {
  if (!status.last_heartbeat_at) return 'No heartbeat yet';
  const heartbeat = new Date(status.last_heartbeat_at);
  if (status.stale) {
    return `Worker not heard from since ${statusTime(status.last_heartbeat_at, now)}`;
  }
  return `last poll ${formatAgo(heartbeat, now)}`;
}
