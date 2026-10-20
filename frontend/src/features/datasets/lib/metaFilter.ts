/**
 * Metadata filters of the items list (A3-9, A3-10): `meta=path:value` in the URL,
 * a dotted path of at most three keys, at most five filters, one value per path.
 */
export const MAX_META_FILTERS = 5;
export const MAX_META_LEVELS = 3;
export const META_LIMIT_HINT = 'You can combine up to 5 metadata filters.';

const KEY_RE = /^[A-Za-z0-9_-]+$/;

export interface MetaFilter {
  path: string;
  value: string;
}

/** A dotted path of one to three keys made of letters, digits, `_` and `-`. */
export function isValidMetaPath(path: string): boolean {
  const parts = path.split('.');
  return parts.length >= 1 && parts.length <= MAX_META_LEVELS && parts.every((p) => KEY_RE.test(p));
}

/** `domain:finance` to `{path, value}`; splits on the first colon (values may hold colons). */
export function parseMetaFilter(raw: string): MetaFilter | null {
  const at = raw.indexOf(':');
  if (at < 0) return null;
  const path = raw.slice(0, at);
  if (!isValidMetaPath(path)) return null;
  return { path, value: raw.slice(at + 1) };
}

export function serializeMetaFilter(filter: MetaFilter): string {
  return `${filter.path}:${filter.value}`;
}

/** The URL's raw values as valid filters, one per path (the last wins), at most five. */
export function parseMetaFilters(raws: readonly string[]): MetaFilter[] {
  const byPath = new Map<string, MetaFilter>();
  for (const raw of raws) {
    const parsed = parseMetaFilter(raw);
    if (parsed) byPath.set(parsed.path, parsed);
  }
  return [...byPath.values()].slice(0, MAX_META_FILTERS);
}

/** The text of a chip: `domain: finance`. */
export function metaChipLabel(filter: MetaFilter): string {
  return `${filter.path}: ${filter.value}`;
}

export function canAddMetaFilter(current: readonly MetaFilter[]): boolean {
  return current.length < MAX_META_FILTERS;
}

/** Add a filter; a second filter on the same path replaces the first. */
export function addMetaFilter(current: readonly MetaFilter[], next: MetaFilter): MetaFilter[] {
  const without = current.filter((f) => f.path !== next.path);
  if (without.length >= MAX_META_FILTERS) return [...current];
  return [...without, next];
}

export function removeMetaFilter(current: readonly MetaFilter[], target: MetaFilter): MetaFilter[] {
  return current.filter((f) => !(f.path === target.path && f.value === target.value));
}

/** `{path: value}` for the batch body. */
export function metaFiltersToObject(filters: readonly MetaFilter[]): Record<string, string> {
  return Object.fromEntries(filters.map((f) => [f.path, f.value]));
}

/** The `meta` URL parameters for a list of filters. */
export function metaFiltersToParams(filters: readonly MetaFilter[]): string[] {
  return filters.map(serializeMetaFilter);
}
