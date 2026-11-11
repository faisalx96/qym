import { describe, expect, it } from 'vitest';
import type { DeletionPreview } from '@/api/types';
import { deleteBlocker } from '../DangerZoneSection';

const preview = (counts: Record<string, number>, can_delete: boolean): DeletionPreview => ({
  project_id: 'p',
  name: 'P',
  slug: 'p',
  archived: false,
  counts,
  can_delete,
  blocked_reason: can_delete ? null : 'blocked',
});

describe('deleteBlocker (C118)', () => {
  it('names the runs and deleted runs that block a delete', () => {
    expect(deleteBlocker(preview({ runs: 9, runs_in_trash: 2 }, false))).toBe(
      'Blocked: 9 runs, 2 deleted runs',
    );
    expect(deleteBlocker(preview({ runs: 1, runs_in_trash: 0 }, false))).toBe(
      'Blocked: 1 run, 0 deleted runs',
    );
  });

  it('says nothing when the project can be deleted or the preview is not loaded', () => {
    expect(deleteBlocker(preview({ runs: 0, runs_in_trash: 0 }, true))).toBeNull();
    expect(deleteBlocker(undefined)).toBeNull();
  });
});
