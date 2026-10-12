import { describe, expect, it } from 'vitest';
import { progressLabel } from '../format';
import type { AdminRunSummary } from '@/api/admin';

const run = { progress_completed: 4, progress_total: 9, total_items: 4 } as AdminRunSummary;

describe('progressLabel', () => {
  it('live shows done/progress_total', () => expect(progressLabel(run, 'live')).toBe('4/9'));
  it('recent keeps total_items', () => expect(progressLabel(run, 'recent')).toBe('4/4'));
  it('live falls back to total_items', () => expect(progressLabel({ ...run, progress_total: null } as AdminRunSummary, 'live')).toBe('4/4'));
});
