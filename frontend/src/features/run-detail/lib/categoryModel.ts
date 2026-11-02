/** Pure helpers of the round 3 categories section (P3): which key opens, how values are ordered, how many show, the switcher choice. */
import {
  categoryInsight,
  categorySpread,
  sortCategoryGroups,
  type CategoryBreakdown,
  type CategoryGroupStat,
} from './overviewModel';

export type CategoryOrder = 'worst' | 'best';

/** Rows shown before "Show all N values". */
export const DEFAULT_VISIBLE_VALUES = 6;

/** The key with the largest best-to-worst spread opens first; the first key when none has a spread. */
export function defaultKey(keys: string[], spreadOf: (key: string) => number): string | null {
  let best: { key: string; spread: number } | null = null;
  for (const k of keys) {
    const spread = spreadOf(k);
    if (!best || spread > best.spread) best = { key: k, spread };
  }
  return best?.key ?? keys[0] ?? null;
}

/** Values ordered worst or best first (direction aware, unscored last). */
export function orderValues(
  groups: CategoryGroupStat[],
  order: CategoryOrder,
  direction: 'maximize' | 'minimize' | null,
): CategoryGroupStat[] {
  return sortCategoryGroups(groups, order, direction);
}

/** The one-sentence insight (null under two scored values). */
export const insightLine = categoryInsight;

/** The first `limit` rows, or all of them once expanded. */
export function visibleValues<T>(rows: T[], limit: number, expanded: boolean): T[] {
  return expanded ? rows : rows.slice(0, limit);
}

/** Spread of a breakdown (re-exported for the default-key choice). */
export const spreadOf = (b: CategoryBreakdown | null): number => (b ? categorySpread(b) : 0);

/**
 * The key switcher: a SegmentedControl for up to 5 keys when their labels fit the column, else a Select.
 * `~7px` per character and 36px of padding per option approximate the 24px control.
 */
export function switcherKind(
  keys: Array<{ key: string; count: number }>,
  columnWidth: number,
): 'segmented' | 'select' {
  if (keys.length > 5) return 'select';
  const need = keys.reduce((a, k) => a + (`${k.key} · ${k.count}`.length * 7 + 36), 0);
  return need <= columnWidth - 220 ? 'segmented' : 'select';
}

/** A value's share of the bar track (0..1): a score is already a fraction, a raw number scales to the largest. */
export function barFraction(value: number | null, max: number | null): number {
  if (value === null) return 0;
  const m = max && max > 0 ? max : 1;
  return Math.max(0, Math.min(1, value / m));
}
