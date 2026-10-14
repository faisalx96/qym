/** Pure classification of a value for StructuredValue: what sections it has and how each one renders. */
import { parseJson } from '../JsonViewer';

export type SectionKind = 'string' | 'scalar' | 'scalars' | 'table' | 'object';

export type Parsed =
  { structured: true; data: Record<string, unknown> | unknown[] } | { structured: false; text: string };

export interface SectionEntry {
  key: string;
  value: unknown;
}

/** Objects, arrays and JSON strings are structured; everything else is plain text. */
export function parseStructured(value: unknown): Parsed {
  if (value !== null && typeof value === 'object') {
    return { structured: true, data: value as Record<string, unknown> };
  }
  const parsed = parseJson(value);
  if (parsed !== null && typeof parsed === 'object') {
    return { structured: true, data: parsed as Record<string, unknown> | unknown[] };
  }
  if (value === null || value === undefined) return { structured: false, text: '' };
  return { structured: false, text: String(value) };
}

/** Top-level sections: object keys, or indexed `[0] [1]` for an array. */
export function entriesOf(data: Record<string, unknown> | unknown[]): SectionEntry[] {
  return Array.isArray(data)
    ? data.map((value, i) => ({ key: `[${i}]`, value }))
    : Object.entries(data).map(([key, value]) => ({ key, value }));
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): boolean => v === null || typeof v !== 'object';

/** An array of 1+ flat objects with at most 10 distinct keys renders as a table. */
export function isUniformObjectArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((v) => isPlain(v) && Object.values(v).every(isScalar))) return false;
  const keys = new Set<string>();
  for (const v of value as Record<string, unknown>[]) for (const k of Object.keys(v)) keys.add(k);
  return keys.size > 0 && keys.size <= 10;
}

export function tableColumns(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

export function classifySection(value: unknown): SectionKind {
  if (typeof value === 'string') return 'string';
  if (isScalar(value)) return 'scalar';
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => isScalar(v) && (typeof v !== 'string' || v.length <= 80))
  ) {
    return 'scalars';
  }
  if (isUniformObjectArray(value)) return 'table';
  return 'object';
}

export function scalarText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Number(value.toPrecision(6)));
  return value === null ? 'null' : String(value);
}

/** The muted line next to a section key. */
export function sectionSummary(value: unknown): string {
  const kind = classifySection(value);
  if (kind === 'string') {
    const s = value as string;
    return s.length > 120 || s.includes('\n') ? `text, ${s.length} chars` : '';
  }
  if (kind === 'scalar') return '';
  if (Array.isArray(value)) {
    if (kind === 'table') return `array of ${value.length} object${value.length === 1 ? '' : 's'}`;
    return `array, ${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  const n = Object.keys(value as object).length;
  return `object, ${n} key${n === 1 ? '' : 's'}`;
}

/** Whether a section starts open under `defaultOpen="auto"`: the first 6 keys, strings up to 600 characters. */
export function startsOpen(index: number, value: unknown, mode: 'auto' | 'all' | 'none'): boolean {
  if (mode === 'all') return true;
  if (mode === 'none') return false;
  if (index >= 6) return false;
  return !(typeof value === 'string' && value.length > 600);
}

/** What the per-section copy button copies: text as is, anything else as JSON. */
export function copyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
