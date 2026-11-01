import { describe, expect, it } from 'vitest';
import type { LiveSourceInfo } from '@/api/live';
import { staleText } from '../lib/stale';

const status: LiveSourceInfo = {
  id: 'source',
  key: 'worker',
  name: 'Worker',
  environment: 'test',
  product: null,
  stale: false,
  seconds_since_heartbeat: 42,
  last_heartbeat_at: '2026-11-01T09:00:00Z',
  last_turn_at: null,
  worker: {},
};

describe('staleText', () => {
  it('counts seconds since the heartbeat for a running worker', () => {
    expect(staleText(status, new Date('2026-11-01T09:00:42Z'))).toBe('last poll 42 s ago');
    expect(staleText(status, new Date('2026-11-01T09:00:52Z'))).toBe('last poll 52 s ago');
  });

  it('reports a stale worker with its last heartbeat time', () => {
    expect(staleText({ ...status, stale: true })).toBe('Worker not heard from since 09:00 UTC');
  });

  it('reports a missing heartbeat and never shows negative ages', () => {
    expect(staleText({ ...status, stale: true, last_heartbeat_at: null })).toBe('No heartbeat yet');
    expect(staleText(status, new Date('2026-11-01T08:59:58Z'))).toBe('last poll 0 s ago');
  });
});
