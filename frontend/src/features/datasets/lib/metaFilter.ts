/**
 * Metadata filters of the items list (A3-9, A3-10, QA1-19 to QA1-24): `meta=path:value` in the URL, repeated for
 * several values of one path, plus `meta_mode=path:any|all` for a path with two or more values. A dotted path of
 * at most three keys, at most five paths, at most twenty values per path.
 */
export const MAX_META_FILTERS = 5;
export const MAX_META_VALUES = 20;
export const MAX_META_LEVELS = 3;
export const META_LIMIT_HINT = 'You can combine up to 5 metadata filters.';

/** `any` = Partial (the item has some of the values), `all` = Full match (it has every one, QD6/E1). */
export type MetaMode = 'any' | 'all';
/** The popover starts on Partial (QD1). */
export const DEFAULT_MODE: MetaMode = 'any';
/** What the API assumes when several values come without a `meta_mode` (QD1). */
export const API_DEFAULT_MODE: MetaMode = 'all';

const KEY_RE = /^[A-Za-z0-9_-]+$/;

export interface MetaFilter {
  path: string;
  /** one or more values, in the order they are written to the URL (facet order) */
  values: string[];
  /** only meaningful with two or more values */
  mode: MetaMode;
}

/** A dotted path of one to three keys made of letters, digits, `_` and `-`. */
export function isValidMetaPath(path: string): boolean {
  const parts = path.split('.');
  return parts.length >= 1 && parts.length <= MAX_META_LEVELS && parts.every((p) => KEY_RE.test(p));
}

/** `domain:finance` to `{path, value}`; splits on the first colon (values may hold colons). */
export function parseMetaPair(raw: string): { path: string; value: string } | null {
  const at = raw.indexOf(':');
  if (at < 0) return null;
  const path = raw.slice(0, at);
  if (!isValidMetaPath(path)) return null;
  return { path, value: raw.slice(at + 1) };
}

/** `tags:any` to its parts, or null when the path or the mode is not valid. */
export function parseMetaModePair(raw: string): { path: string; mode: MetaMode } | null {
  const at = raw.indexOf(':');
  if (at < 0) return null;
  const path = raw.slice(0, at);
  const mode = raw.slice(at + 1);
  if (!isValidMetaPath(path) || (mode !== 'any' && mode !== 'all')) return null;
  return { path, mode };
}

/**
 * The URL's raw `meta` and `meta_mode` values as filters, one per path (values of a path are merged, duplicates and
 * values past twenty dropped), at most five paths. A mode without a `meta` of its path is dropped; a bad or missing
 * mode on a path with several values means `all`, the API default (QA1-22).
 */
export function parseMetaFilters(raws: readonly string[], modes: readonly string[] = []): MetaFilter[] {
  const byPath = new Map<string, string[]>();
  for (const raw of raws) {
    const pair = parseMetaPair(raw);
    if (!pair) continue;
    const values = byPath.get(pair.path) ?? [];
    if (!values.includes(pair.value) && values.length < MAX_META_VALUES) values.push(pair.value);
    byPath.set(pair.path, values);
  }
  const modeByPath = new Map<string, MetaMode>();
  for (const raw of modes) {
    const pair = parseMetaModePair(raw);
    if (pair && byPath.has(pair.path) && !modeByPath.has(pair.path)) modeByPath.set(pair.path, pair.mode);
  }
  return [...byPath.entries()]
    .slice(0, MAX_META_FILTERS)
    .map(([path, values]) => ({ path, values, mode: modeByPath.get(path) ?? API_DEFAULT_MODE }));
}

/** The text of a chip: `domain: finance`, or `tags: billing, refund (any)` for several values. */
export function metaChipLabel(filter: MetaFilter): string {
  if (filter.values.length < 2) return `${filter.path}: ${filter.values[0] ?? ''}`;
  return `${filter.path}: ${filter.values.join(', ')} (${filter.mode})`;
}

export function canAddMetaFilter(current: readonly MetaFilter[]): boolean {
  return current.length < MAX_META_FILTERS;
}

/** Add a filter; a second filter on the same path replaces the first (one chip per path). */
export function addMetaFilter(current: readonly MetaFilter[], next: MetaFilter): MetaFilter[] {
  const without = current.filter((f) => f.path !== next.path);
  if (without.length >= MAX_META_FILTERS) return [...current];
  return [...without, next];
}

/** Remove the chip of a path (removing deletes every `meta` and the `meta_mode` of that path). */
export function removeMetaFilter(
  current: readonly MetaFilter[],
  target: Pick<MetaFilter, 'path'>,
): MetaFilter[] {
  return current.filter((f) => f.path !== target.path);
}

/** Values sorted the way the facet list shows them (count descending, then value) so one filter has one URL. */
export function orderByFacet(chosen: readonly string[], facetValues: readonly { value: string }[]): string[] {
  const rank = new Map(facetValues.map((v, i) => [v.value, i]));
  return [...chosen].sort(
    (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b),
  );
}

/** The batch body's `meta`: a scalar for one value, `{values, mode}` for several (QA1-54). */
export function metaFiltersToObject(
  filters: readonly MetaFilter[],
): Record<string, string | { values: string[]; mode: MetaMode }> {
  return Object.fromEntries(
    filters.map((f) => [
      f.path,
      f.values.length < 2 ? (f.values[0] ?? '') : { values: f.values, mode: f.mode },
    ]),
  );
}

/** The `meta` URL parameters for a list of filters: one `path:value` per value. */
export function metaFiltersToParams(filters: readonly MetaFilter[]): string[] {
  return filters.flatMap((f) => f.values.map((v) => `${f.path}:${v}`));
}

/** The `meta_mode` URL parameters: one per path with two or more values. */
export function metaModesToParams(filters: readonly MetaFilter[]): string[] {
  return filters.filter((f) => f.values.length >= 2).map((f) => `${f.path}:${f.mode}`);
}
