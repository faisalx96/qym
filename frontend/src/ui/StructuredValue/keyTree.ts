/** Pure helpers of the key tree (round 3 P5): previews, open-state paths and the recursive expand / collapse sets. */

export type Json = unknown;

export const isObject = (v: Json): v is Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const isNested = (v: Json): boolean => v !== null && typeof v === 'object';

/** The rows of one level: object keys, or `[0] [1]` for an array. */
export function childEntries(value: Json): Array<{ key: string; segment: string; value: Json }> {
  if (Array.isArray(value)) return value.map((v, i) => ({ key: `[${i}]`, segment: String(i), value: v }));
  if (isObject(value)) return Object.entries(value).map(([k, v]) => ({ key: k, segment: k, value: v }));
  return [];
}

/** `object · 2 keys` / `array · 2 items` for a nested value; the scalar text itself otherwise. */
export function previewOf(value: Json): string {
  if (Array.isArray(value)) return `array · ${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (isObject(value)) {
    const n = Object.keys(value).length;
    return `object · ${n} ${n === 1 ? 'key' : 'keys'}`;
  }
  if (value === null) return 'null';
  if (value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Every key path below `value` (all depths): `prefix/key`, `prefix/key/0`, ... */
export function allPaths(value: Json, prefix: string, out: string[] = []): string[] {
  for (const c of childEntries(value)) {
    const p = `${prefix}/${c.segment}`;
    out.push(p);
    allPaths(c.value, p, out);
  }
  return out;
}

/** Expand all on one key: the key itself and every descendant open. */
export function expandKey(open: Set<string>, value: Json, path: string): Set<string> {
  const next = new Set(open);
  next.add(path);
  allPaths(value, path).forEach((p) => next.add(p));
  return next;
}

/** Collapse all on one key: every descendant closed, the key itself stays open. */
export function collapseBelow(open: Set<string>, value: Json, path: string): Set<string> {
  const next = new Set(open);
  allPaths(value, path).forEach((p) => next.delete(p));
  return next;
}

/** Arrays of this many elements or more show the first 20 and "Show N more". */
export const ARRAY_LIMIT = 20;

/** A string longer than this opens to 12 lines with "Show full value". */
export const LONG_STRING = 400;

export const looksSql = (key: string, text: string): boolean =>
  /(^|_)(sql|query)$/i.test(key) ||
  /^\s*(select|with|insert|update|delete)\b[\s\S]*\b(from|into|set|as)\b/i.test(text);
