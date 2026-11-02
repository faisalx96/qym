/** The open pass groups of the runs list, kept for the tab (session only) so Back returns to the same groups. */
import type { RunRow } from '@/api/dashboardTypes';

export const expandedKey = (slug: string) => `qym:runs:expanded:${slug}`;

export function readExpanded(slug: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(expandedKey(slug));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeExpanded(slug: string, ids: Set<string>): void {
  try {
    if (ids.size) sessionStorage.setItem(expandedKey(slug), JSON.stringify([...ids]));
    else sessionStorage.removeItem(expandedKey(slug));
  } catch {
    /* storage unavailable: the groups just are not remembered */
  }
}

/** Drops ids of loaded runs that cannot expand; ids of runs not on the loaded page are kept (paging). */
export function pruneExpanded(ids: Set<string>, loaded: Pick<RunRow, 'run_id' | 'samples'>[]): Set<string> {
  const bySamples = new Map(loaded.map((r) => [r.run_id, r.samples]));
  const out = new Set<string>();
  for (const id of ids) {
    const n = bySamples.get(id);
    if (n === undefined || n > 1) out.add(id);
  }
  return out.size === ids.size ? ids : out;
}
