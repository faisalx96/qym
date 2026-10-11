import { describe, expect, it } from 'vitest';
import type { TrashRun } from '@/api/trash';
import { purgeInfo } from '../TrashPage';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const run = (p: Partial<TrashRun>) => ({ purge_at: null, purge_paused: false, project_archived: false, ...p }) as TrashRun;
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('purgeInfo', () => {
  it('counts down with warning under 3 days and danger when due', () => {
    expect(purgeInfo(run({ purge_at: inDays(10) }), NOW)).toMatchObject({ text: 'in 10 days', tone: undefined, soon: false });
    expect(purgeInfo(run({ purge_at: inDays(2) }), NOW)).toMatchObject({ text: 'in 2 days', tone: 'warning', soon: true });
    expect(purgeInfo(run({ purge_at: inDays(0.5) }), NOW)).toMatchObject({ text: 'in under 1 day', tone: 'danger' });
    expect(purgeInfo(run({ purge_at: inDays(-1) }), NOW)).toMatchObject({ text: 'Due now', tone: 'danger' });
  });
  it('pauses for archived projects and handles unscheduled runs', () => {
    expect(purgeInfo(run({ project_archived: true, purge_at: inDays(5) }), NOW).text).toBe('Paused');
    expect(purgeInfo(run({}), NOW).text).toBe('Not scheduled');
  });
});
