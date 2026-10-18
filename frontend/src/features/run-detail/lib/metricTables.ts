/**
 * Which metric detail values are tables (round 5 R3): `{columns, rows}` (rows as arrays or objects), an array of arrays, and an
 * array of at least two plain objects with scalar values whose key sets overlap by 80% or more. Pure.
 */

export const TABLE_ROW_CAP = 200;
export const TABLE_PAGE = 12;

export type Cell = string | number | boolean | null;

export interface DetectedTable {
  columns: string[];
  /** One record per row (keys are `columns`), at most `TABLE_ROW_CAP`. */
  rows: Array<Record<string, Cell>>;
  /** Rows in the value before the cap. */
  total: number;
}

const isScalar = (v: unknown): v is Cell =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function capped(columns: string[], records: Array<Record<string, Cell>>): DetectedTable {
  return { columns, rows: records.slice(0, TABLE_ROW_CAP), total: records.length };
}

/** `{columns, rows}`: `columns` is a list of strings, `rows` a list of arrays (cells by column) or of objects. */
function fromColumnsRows(value: Record<string, unknown>): DetectedTable | null {
  const keys = Object.keys(value);
  if (keys.length !== 2 || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  const columns = value.columns;
  if (!columns.length || !columns.every((c) => typeof c === 'string' && c !== '')) return null;
  if (new Set(columns).size !== columns.length) return null;
  const names = columns as string[];
  const rows = value.rows as unknown[];
  const records: Array<Record<string, Cell>> = [];
  for (const r of rows) {
    if (Array.isArray(r)) {
      if (!r.every(isScalar)) return null;
      records.push(Object.fromEntries(names.map((c, i) => [c, (r[i] ?? null) as Cell])));
    } else if (isPlainObject(r)) {
      if (!Object.values(r).every(isScalar)) return null;
      records.push(Object.fromEntries(names.map((c) => [c, (r[c] ?? null) as Cell])));
    } else return null;
  }
  return capped(names, records);
}

/** An array of at least two arrays of scalars: columns are "Column 1", "Column 2" ... */
function fromArrays(value: unknown[]): DetectedTable | null {
  if (value.length < 2 || !value.every((r) => Array.isArray(r) && r.length > 0 && r.every(isScalar)))
    return null;
  const width = Math.max(...value.map((r) => (r as unknown[]).length));
  const columns = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const records = (value as Cell[][]).map((r) =>
    Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? null) as Cell])),
  );
  return capped(columns, records);
}

/** At least two plain objects, scalar values, each holding at least 80% of the union of all keys. */
function fromObjects(value: unknown[]): DetectedTable | null {
  if (value.length < 2 || !value.every((r) => isPlainObject(r) && Object.keys(r).length > 0)) return null;
  const objs = value as Array<Record<string, unknown>>;
  if (!objs.every((o) => Object.values(o).every(isScalar))) return null;
  const columns: string[] = [];
  for (const o of objs) for (const k of Object.keys(o)) if (!columns.includes(k)) columns.push(k);
  if (!objs.every((o) => Object.keys(o).length / columns.length >= 0.8)) return null;
  const records = objs.map((o) => Object.fromEntries(columns.map((c) => [c, (o[c] ?? null) as Cell])));
  return capped(columns, records);
}

/** The table behind a detail value, or null when it should stay a key tree (mixed arrays, nested objects, scalars). */
export function detectTable(value: unknown): DetectedTable | null {
  if (Array.isArray(value)) return fromArrays(value) ?? fromObjects(value);
  if (isPlainObject(value)) return fromColumnsRows(value);
  return null;
}
