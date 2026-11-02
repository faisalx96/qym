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

/** Gap between two triggers in the row. */
const GAP = 8;
/** Room kept for `Clear n` (shown only while a filter is active). */
export const CLEAR_RESERVE = 96;
/** Room kept for `More filters` (versioning keys, or facets that do not fit). */
export const MORE_RESERVE = 124;

/** Width of a bar trigger with this text ("Status · Completed"): 96 to 168 px (11 px sans, chevron and padding). */
export function triggerWidth(text: string): number {
  return Math.min(168, Math.max(96, Math.round(36 + 5.6 * text.length)));
}

/**
 * Facet ids that stay inline in a bar `width` px wide, in display order. Versioning keys (`v.*`) always live under
 * `More filters`, as do the facets that do not fit (lowest priority first; never fewer than Status, Model, Task).
 * `textOf` gives a trigger's text (its width follows it); `clear` = a filter is active, so `Clear n` shows. Room for
 * `More filters` is kept only when it will show (round 8: the table controls share the bar's width).
 * `width <= 0` (unmeasured) keeps all.
 */
export function inlineFacets(
  width: number,
  ids: string[],
  textOf: (id: string) => string = (id) => FACET_SINGULAR[id] ?? id,
  clear = true,
): string[] {
  const base = ids.filter((id) => (FACET_ORDER as readonly string[]).includes(id));
  if (!(width > 0)) return base;
  const byPriority = (FACET_PRIORITY as readonly string[]).filter((id) => base.includes(id));
  const extra = ids.length > base.length;
  const room = (n: number) => {
    const triggers = byPriority.slice(0, n).reduce((sum, id) => sum + triggerWidth(textOf(id)) + GAP, 0);
    const more = extra || n < byPriority.length ? MORE_RESERVE : 0;
    return triggers + more + (clear ? CLEAR_RESERVE : 0);
  };
  let capacity = byPriority.length;
  while (capacity > 3 && room(capacity) > width) capacity -= 1;
  const keep = new Set(byPriority.slice(0, capacity));
  return base.filter((id) => keep.has(id));
}
