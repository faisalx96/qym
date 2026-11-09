import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSourceInfo } from '@/api/live';
import { formatTableDate } from '@/lib/dates';
import { staleText, statusTime } from '../lib/stale';

const status: LiveSourceInfo = {
  id: 'source',
  key: 'worker',
  name: 'Worker',
  environment: 'test',
  product: null,
  stale: false,
  seconds_since_heartbeat: 42,
  last_heartbeat_at: '2026-11-01T09:00:00Z',
  last_poll_at: null,
  last_turn_at: null,
  worker: {},
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T09:00:42Z'));
});
afterEach(() => vi.useRealTimers());

describe('statusTime', () => {
  it('uses the table date form on the viewer clock', () => {
    const now = new Date(2026, 10, 1, 9, 0);
    expect(statusTime(new Date(2026, 10, 1, 8, 31).toISOString(), now)).toBe('Nov 1 · 08:31');
    expect(statusTime(new Date(2026, 9, 14, 12, 31).toISOString(), now)).toBe('Oct 14 · 12:31');
    expect(statusTime('2026-11-01T08:31:00Z')).not.toContain('UTC');
  });
});

describe('staleText', () => {
  it('words the time since the heartbeat with formatAgo', () => {
    expect(staleText(status, new Date('2026-11-01T09:00:42Z'))).toBe('last poll just now');
    expect(staleText(status, new Date('2026-11-01T09:00:52Z'))).toBe('last poll 1m ago');
  });

  it('reports a stale worker with its last heartbeat time on the viewer clock', () => {
    expect(staleText({ ...status, stale: true })).toBe(
      `Worker not heard from since ${formatTableDate('2026-11-01T09:00:00Z')}`,
    );
    expect(staleText({ ...status, stale: true, last_heartbeat_at: '2026-10-14T12:25:00Z' })).toBe(
      `Worker not heard from since ${formatTableDate('2026-10-14T12:25:00Z')}`,
    );
  });

  it('reports a missing heartbeat and never shows negative ages', () => {
    expect(staleText({ ...status, stale: true, last_heartbeat_at: null })).toBe('No heartbeat yet');
    expect(staleText(status, new Date('2026-11-01T08:59:58Z'))).toBe('last poll just now');
  });
});
