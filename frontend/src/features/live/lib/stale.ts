import type { LiveSourceInfo } from '@/api/live';

export function statusTime(timestamp: string, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const day =
    date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
      ? ''
      : `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} `;
  return `${day}${time} UTC`;
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
