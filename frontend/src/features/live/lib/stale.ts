import type { LiveSourceInfo } from '@/api/live';

export function staleText(status: LiveSourceInfo, now: Date = new Date()): string {
  if (!status.last_heartbeat_at) return 'No heartbeat yet';
  const heartbeat = new Date(status.last_heartbeat_at);
  if (status.stale) {
    const time = heartbeat.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    return `Worker not heard from since ${time} UTC`;
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - heartbeat.getTime()) / 1000));
  return `last poll ${seconds} s ago`;
}
