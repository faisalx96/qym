/**
 * Add-to-draft re-imports (C006): count the records whose item_id is already in the draft, and say what the
 * import did. The server replaces a matching item unless the request says `on_existing: 'skip'`.
 */
import { BULK_CHUNK, type BulkSummary, type ItemBody } from '@/api/datasets';
import { pluralize } from './itemValue';

export type ImportCounts = Pick<BulkSummary, 'created' | 'updated' | 'skipped'>;

export const NO_COUNTS: ImportCounts = { created: 0, updated: 0, skipped: 0 };

export function addCounts(a: ImportCounts, b: ImportCounts): ImportCounts {
  return { created: a.created + b.created, updated: a.updated + b.updated, skipped: a.skipped + b.skipped };
}

/** The item_id of every record that has one, repeats kept: the match count is per record. */
export function recordIds(upserts: ItemBody[]): string[] {
  return upserts.flatMap((u) => (u.item_id ? [u.item_id] : []));
}

/**
 * Records whose item_id names an item already in the draft. One dry run per chunk of `BULK_CHUNK` ids, in
 * sequence; each dry run sends the ids only.
 */
export async function countMatches(
  ids: string[],
  preview: (upserts: ItemBody[]) => Promise<{ matched: number }>,
): Promise<number> {
  let matched = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const r = await preview(ids.slice(i, i + BULK_CHUNK).map((item_id) => ({ item_id })));
    matched += r.matched;
  }
  return matched;
}

/** Review line: "4 of 4 records match items already in v1." */
export function matchLine(matched: number, total: number, noun: string, version: string): string {
  const verb = matched === 1 ? 'matches an item' : 'match items';
  return `${matched.toLocaleString()} of ${pluralize(total, noun)} ${verb} already in ${version}.`;
}

/** Toast after an import: "4 items added", or "0 added, 4 skipped" when records matched existing items. */
export function importResultText(c: ImportCounts): string {
  if (!c.updated && !c.skipped) return `${pluralize(c.created, 'item')} added`;
  const parts = [`${c.created.toLocaleString()} added`];
  if (c.updated) parts.push(`${c.updated.toLocaleString()} replaced`);
  if (c.skipped) parts.push(`${c.skipped.toLocaleString()} skipped`);
  return parts.join(', ');
}
