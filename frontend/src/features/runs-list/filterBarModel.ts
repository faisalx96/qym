/** Pure rules of the runs filter bar: which facets stay inline and how triggers are named. */

/** Display order (legacy: muscle memory carries over). */
export const FACET_ORDER = ['tasks', 'datasets', 'models', 'versions', 'statuses', 'owners'] as const;
/** Overflow priority: the first ones stay inline longest. */
export const FACET_PRIORITY = ['statuses', 'models', 'tasks', 'datasets', 'owners', 'versions'] as const;
export const FACET_SINGULAR: Record<string, string> = {
  tasks: 'Task',
  datasets: 'Dataset',
  models: 'Model',
  versions: 'Version',
  statuses: 'Status',
  owners: 'User',
};

/** Width one facet trigger needs in the bar (max 168 plus the gap, typical ~120). */
export const FACET_SLOT = 124;
/** Room kept for `More filters` and `Clear n`. */
export const FACET_RESERVE = 220;

/**
 * Facet ids that stay inline in a bar `width` px wide, in display order. Versioning keys (`v.*`) always live under
 * `More filters`, as do the facets that do not fit (lowest priority first). `width <= 0` (unmeasured) keeps all.
 */
export function inlineFacets(width: number, ids: string[]): string[] {
  const base = ids.filter((id) => (FACET_ORDER as readonly string[]).includes(id));
  if (!(width > 0)) return base;
  const capacity = Math.max(3, Math.floor((width - FACET_RESERVE) / FACET_SLOT));
  const keep = new Set(
    (FACET_PRIORITY as readonly string[]).filter((id) => base.includes(id)).slice(0, capacity),
  );
  return base.filter((id) => keep.has(id));
}
