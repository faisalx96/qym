/** CSV column → role mapping for the upload wizard (pure). */
import type { ItemBody } from '@/api/datasets';
import { importLabels } from './jsonRecords';

export type ColumnRole = 'input' | 'expected' | 'metadata' | 'id' | 'ignore';

export const COLUMN_ROLES: { value: ColumnRole; label: string }[] = [
  { value: 'input', label: 'Input' },
  { value: 'expected', label: 'Expected output' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'id', label: 'Item ID' },
  { value: 'ignore', label: 'Ignore (not imported)' },
];

export interface ColumnMapping {
  input: string[];
  expected: string[];
  metadata: string[];
  id: string;
}

const INPUT_NAMES = ['input', 'question', 'prompt', 'text'];
const EXPECTED_NAMES = ['expected_output', 'expected', 'answer', 'output', 'target', 'label'];
const ID_NAMES = ['id', 'item_id', 'example_id'];

/** Best-effort detection by header name; every other column becomes Metadata. */
export function autoMap(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n);
      if (i !== -1) return headers[i] ?? '';
    }
    return '';
  };
  const input = find(INPUT_NAMES);
  const expected = find(EXPECTED_NAMES);
  const id = find(ID_NAMES);
  return {
    input: input ? [input] : [],
    expected: expected ? [expected] : [],
    id,
    metadata: headers.filter((c) => c && c !== input && c !== expected && c !== id),
  };
}

export function columnRole(mapping: ColumnMapping, col: string): ColumnRole {
  if (mapping.id === col) return 'id';
  if (mapping.input.includes(col)) return 'input';
  if (mapping.expected.includes(col)) return 'expected';
  if (mapping.metadata.includes(col)) return 'metadata';
  return 'ignore';
}

/** Assign one column to one role; a second Item ID demotes the previous one to Metadata. */
export function setColumnRole(mapping: ColumnMapping, col: string, role: ColumnRole): ColumnMapping {
  const next: ColumnMapping = {
    input: mapping.input.filter((c) => c !== col),
    expected: mapping.expected.filter((c) => c !== col),
    metadata: mapping.metadata.filter((c) => c !== col),
    id: mapping.id === col ? '' : mapping.id,
  };
  if (role === 'id') {
    if (next.id && next.id !== col) next.metadata.push(next.id);
    next.id = col;
  } else if (role !== 'ignore') {
    next[role].push(col);
  }
  return next;
}

export function mappingSummary(mapping: ColumnMapping): string {
  const parts = [
    `Input: ${mapping.input.length ? mapping.input.join(' + ') : 'none'}`,
    `Expected: ${mapping.expected.length ? mapping.expected.join(' + ') : 'none'}`,
    `Item ID: ${mapping.id || 'generated'}`,
    `${mapping.metadata.length} metadata column${mapping.metadata.length === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

export function ignoredColumns(headers: string[], mapping: ColumnMapping): string[] {
  return headers.filter((c) => columnRole(mapping, c) === 'ignore');
}

/** Add-to-draft: CSV rows → bulk upserts (one column → raw value; several → object). */
export function csvUpserts(headers: string[], rows: string[][], mapping: ColumnMapping): ItemBody[] {
  const idx = new Map(headers.map((h, i) => [h, i] as const));
  const get = (row: string[], col: string) => {
    const i = idx.get(col);
    return i === undefined ? null : (row[i] ?? null);
  };
  const combine = (row: string[], cols: string[]): unknown => {
    if (!cols.length) return undefined;
    if (cols.length === 1) return get(row, cols[0] ?? '');
    const o: Record<string, unknown> = {};
    for (const c of cols) o[c] = get(row, c);
    return o;
  };
  return rows.map((row) => {
    const entry: ItemBody = {};
    const id = mapping.id ? get(row, mapping.id) : null;
    if (id) entry.item_id = String(id);
    entry.input = combine(row, mapping.input) ?? null;
    if (mapping.expected.length) entry.expected_output = combine(row, mapping.expected);
    if (mapping.metadata.length) {
      const meta: Record<string, unknown> = {};
      for (const c of mapping.metadata) meta[c] = get(row, c);
      entry.metadata = meta;
    }
    return entry;
  });
}

/** Add-to-draft: JSON records → bulk upserts (same aliases as the server). */
export function jsonUpserts(rows: Record<string, unknown>[]): ItemBody[] {
  return rows.map((r) => {
    const entry: ItemBody = {};
    const id = String(r.item_id ?? r.id ?? '').trim();
    if (id) entry.item_id = id;
    entry.input = r.input;
    if (r.expected_output !== undefined) entry.expected_output = r.expected_output;
    else if (r.expected !== undefined) entry.expected_output = r.expected;
    if (r.metadata && typeof r.metadata === 'object') entry.metadata = r.metadata as Record<string, unknown>;
    const labels = importLabels(r.labels);
    if (labels.length) entry.labels = labels;
    return entry;
  });
}
