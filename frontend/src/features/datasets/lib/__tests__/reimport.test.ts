import { describe, expect, it, vi } from 'vitest';
import { BULK_CHUNK } from '@/api/datasets';
import { addCounts, countMatches, importResultText, matchLine, recordIds } from '../reimport';

describe('re-import helpers (C006)', () => {
  it('names created, replaced and skipped items in the toast', () => {
    expect(importResultText({ created: 4, updated: 0, skipped: 0 })).toBe('4 items added');
    expect(importResultText({ created: 1, updated: 0, skipped: 0 })).toBe('1 item added');
    expect(importResultText({ created: 0, updated: 4, skipped: 0 })).toBe('0 added, 4 replaced');
    expect(importResultText({ created: 1, updated: 0, skipped: 3 })).toBe('1 added, 3 skipped');
    expect(importResultText({ created: 1200, updated: 0, skipped: 3 })).toBe('1,200 added, 3 skipped');
  });

  it('never calls replaced or skipped items "added"', () => {
    // The old toast summed created + updated as "added" (UploadWizard.tsx:241 and :255).
    expect(importResultText({ created: 0, updated: 4, skipped: 0 })).not.toMatch(/4 items? added/);
  });

  it('writes the Review line', () => {
    expect(matchLine(4, 4, 'record', 'v1')).toBe('4 of 4 records match items already in v1.');
    expect(matchLine(1, 3, 'row', 'v2')).toBe('1 of 3 rows matches an item already in v2.');
  });

  it('keeps one id per record that has one', () => {
    expect(recordIds([{ item_id: 'a' }, { input: 1 }, { item_id: 'a' }, { item_id: '' }])).toEqual([
      'a',
      'a',
    ]);
  });

  it('adds the per-batch counts', () => {
    expect(
      addCounts({ created: 1, updated: 2, skipped: 3 }, {
        created: 10,
        updated: 0,
        skipped: 5,
        deleted: 7,
      } as never),
    ).toEqual({ created: 11, updated: 2, skipped: 8 });
  });

  it('counts matches one chunk at a time with the ids only', async () => {
    const ids = Array.from({ length: BULK_CHUNK + 5 }, (_, i) => `id-${i}`);
    const preview = vi.fn(async (upserts: { item_id?: string }[]) => ({ matched: upserts.length - 1 }));
    expect(await countMatches(ids, preview)).toBe(BULK_CHUNK - 1 + 4);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview.mock.calls[0]![0]).toHaveLength(BULK_CHUNK);
    expect(preview.mock.calls[1]![0]).toEqual(ids.slice(BULK_CHUNK).map((item_id) => ({ item_id })));
    expect(await countMatches([], preview)).toBe(0);
    expect(preview).toHaveBeenCalledTimes(2);
  });
});
