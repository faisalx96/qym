import type { ItemLineageResponse, ItemRevision } from '@/api/datasets';

type Lineage = ItemLineageResponse['lineage'];

const byTimeDesc = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/**
 * The item history newest first (C189): versions newest first, and the revisions in each version newest first. Each
 * revision gets a number per item (1 = the oldest across all versions), not per version, so "#3" names one revision.
 */
export function orderItemHistory(lineage: Lineage): { lineage: Lineage; numberOf: Map<string, number> } {
  const all = lineage.flatMap((l) => l.revisions);
  const oldestFirst = [...all].sort((a, b) => -byTimeDesc(a, b));
  const numberOf = new Map(oldestFirst.map((r, i) => [r.id, i + 1] as const));
  const ordered = [...lineage]
    .sort((a, b) => byTimeDesc({ ...a.version, id: a.version.id }, { ...b.version, id: b.version.id }))
    .map((l) => ({ ...l, revisions: [...l.revisions].sort(byTimeDesc) }));
  return { lineage: ordered, numberOf };
}

/** A type change is news only on an update: a created or deleted item has no "before" or "after" of its own. */
export function showsTypeChange(r: ItemRevision): boolean {
  return r.change_type === 'updated';
}
