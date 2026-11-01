import { describe, expect, it } from 'vitest';
import type { ItemLineageResponse, ItemRevision } from '@/api/datasets';
import { orderItemHistory, showsTypeChange } from '../itemHistory';

const rev = (id: string, at: string, change_type: ItemRevision['change_type'] = 'updated') =>
  ({ id, created_at: at, change_type, revision_number: 1 }) as ItemRevision;
const ver = (id: string, at: string, revisions: ItemRevision[]) =>
  ({
    version: { id, version: id, created_at: at },
    item: null,
    revisions,
  }) as unknown as ItemLineageResponse['lineage'][number];

describe('orderItemHistory (C189)', () => {
  it('lists versions and revisions newest first and numbers revisions per item', () => {
    const { lineage, numberOf } = orderItemHistory([
      ver('v1', '2026-10-01', [rev('a', '2026-10-01T10:00', 'created')]),
      ver('v3', '2026-10-20', [rev('c', '2026-10-21T09:00'), rev('d', '2026-10-22T09:00')]),
      ver('v2', '2026-10-10', [rev('b', '2026-10-11T10:00')]),
    ]);
    expect(lineage.map((l) => l.version.version)).toEqual(['v3', 'v2', 'v1']);
    expect(lineage[0]!.revisions.map((r) => r.id)).toEqual(['d', 'c']);
    expect(['a', 'b', 'c', 'd'].map((id) => numberOf.get(id))).toEqual([1, 2, 3, 4]);
  });

  it('shows a type change only on an update', () => {
    expect(showsTypeChange(rev('x', '', 'created'))).toBe(false);
    expect(showsTypeChange(rev('x', '', 'deleted'))).toBe(false);
    expect(showsTypeChange(rev('x', '', 'updated'))).toBe(true);
  });
});
