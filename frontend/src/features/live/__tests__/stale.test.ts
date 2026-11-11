import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSourceInfo } from '@/api/live';
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
  it('shows only the time for today in UTC', () => {
    expect(statusTime('2026-11-01T08:31:00Z')).toBe('08:31 UTC');
  });

  it('includes the day and short month for an older timestamp', () => {
    expect(statusTime('2026-10-14T12:31:00Z')).toBe('14 Oct 12:31 UTC');
  });

  it('compares UTC dates across midnight and timezone offsets', () => {
    vi.setSystemTime(new Date('2026-11-01T00:05:00Z'));
    expect(statusTime('2026-11-01T02:31:00+03:00')).toBe('31 Oct 23:31 UTC');
    expect(statusTime('2026-11-01T03:01:00+03:00')).toBe('00:01 UTC');
  });
});

describe('staleText', () => {
  it('counts seconds since the heartbeat for a running worker', () => {
    expect(staleText(status, new Date('2026-11-01T09:00:42Z'))).toBe('last poll 42 s ago');
    expect(staleText(status, new Date('2026-11-01T09:00:52Z'))).toBe('last poll 52 s ago');
  });

  it('reports a stale worker with its last heartbeat time', () => {
    expect(staleText({ ...status, stale: true })).toBe('Worker not heard from since 09:00 UTC');
  });

  it('includes the date when a stale heartbeat is from another UTC day', () => {
    expect(staleText({ ...status, stale: true, last_heartbeat_at: '2026-10-14T12:25:00Z' })).toBe(
      'Worker not heard from since 14 Oct 12:25 UTC',
    );
  });

  it('reports a missing heartbeat and never shows negative ages', () => {
    expect(staleText({ ...status, stale: true, last_heartbeat_at: null })).toBe('No heartbeat yet');
    expect(staleText(status, new Date('2026-11-01T08:59:58Z'))).toBe('last poll 0 s ago');
  });
});
