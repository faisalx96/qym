import { describe, expect, it } from 'vitest';
import type { Freshness } from '@/api/dashboardTypes';
import { freshnessCopy } from '../StatusBar';

const fresh: Freshness = {
  updating: false,
  backfilling: false,
  pending_partitions: 0,
  unpublished_runs: 0,
  failed_partitions: 0,
  oldest_pending_at: null,
};

describe('summary freshness copy', () => {
  it('says nothing when summaries are current', () => {
    expect(freshnessCopy(fresh)).toBeNull();
    expect(freshnessCopy(undefined)).toBeNull();
  });
  it('discloses runs still being prepared and that totals cover the ready ones', () => {
    expect(freshnessCopy({ ...fresh, updating: true, backfilling: true, unpublished_runs: 5 })).toBe(
      '5 runs preparing · totals cover ready runs',
    );
  });
  it('says the summaries are updating when nothing is left to prepare', () => {
    expect(freshnessCopy({ ...fresh, updating: true, backfilling: true })).toBe('Updating summaries…');
  });
  it('flags summaries that need attention first', () => {
    expect(freshnessCopy({ ...fresh, updating: true, failed_partitions: 2, unpublished_runs: 3 })).toMatch(
      /need attention/,
    );
  });
});
