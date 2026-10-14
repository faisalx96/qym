/**
 * Lists as override tables: the generic mapping behind every list of the environment schema.
 * A list is shown as a table with a global ("All items") row over per-element rows; the mapping
 * decides the columns, and returns null when the list does not fit a table (it is then edited as
 * cards or JSON text).
 *
 *  - `listTableModel(value)`   a JSON list: scalars (one "Value" column) or objects sharing a key set
 *  - `collectionTableModel(c)` a keyed collection of the settings tree (endpoints): one column per
 *                              scalar field of the item, a row per key, the global row from `allItems`
 */
import type { AllItemsField, CollectionItemView, CollectionNode, LeafNode } from './settingsTree';
import type { JsonObject, JsonValue } from './types';

export type ListColumnKind = 'string' | 'number' | 'boolean' | 'null' | 'auto';

export interface ListTableColumn {
  /** Object key; null for the single column of a list of scalars. */
  key: string | null;
  label: string;
  kind: ListColumnKind;
  /** Every element has a scalar here, so the global row can write it. */
  scalar: boolean;
}

export interface ListTableModel {
  shape: 'scalars' | 'objects';
  columns: ListTableColumn[];
  rows: number;
}

const isObj = (v: unknown): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalarValue = (v: unknown): boolean => v === null || typeof v !== 'object';

function kindOf(v: JsonValue | undefined): string {
  return v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

/** The kind a column of values is edited as (a mixed column reads typed text as JSON). */
export function columnKind(values: readonly (JsonValue | undefined)[]): ListColumnKind {
  const first = kindOf(values[0]);
  return values.every((v) => kindOf(v) === first) &&
    (first === 'string' || first === 'number' || first === 'boolean')
    ? first
    : 'auto';
}

/** Keys of a non-empty list of objects that all share the same (non-empty) key set. */
export function uniformKeys(list: readonly JsonValue[]): string[] | null {
  if (!list.length || !list.every(isObj)) return null;
  const objs = list as JsonObject[];
  const keys = Object.keys(objs[0] as JsonObject);
  if (!keys.length) return null;
  const sig = keys.slice().sort().join('\u0000');
  return objs.every((o) => Object.keys(o).sort().join('\u0000') === sig) ? keys : null;
}

export function listTableModel(list: readonly JsonValue[]): ListTableModel | null {
  if (!list.length) return null;
  if (list.every(isScalarValue)) {
    return {
      shape: 'scalars',
      rows: list.length,
      columns: [{ key: null, label: 'Value', kind: columnKind(list), scalar: true }],
    };
  }
  const keys = uniformKeys(list);
  if (!keys) return null;
  const objs = list as JsonObject[];
  return {
    shape: 'objects',
    rows: list.length,
    columns: keys.map((key) => {
      const values = objs.map((o) => o[key]);
      return { key, label: key, kind: columnKind(values), scalar: values.every(isScalarValue) };
    }),
  };
}

export interface CollectionTableModel {
  columns: Array<{ template: string; label: string }>;
  rows: Array<{ item: CollectionItemView; cells: LeafNode[] }>;
  /** The global row: one control per column (null when the column cannot be written globally). */
  allRow: Array<AllItemsField | null>;
}

/**
 * A collection whose items are flat (every child a leaf, the same leaves in each item) renders as a
 * table; null otherwise (nested objects, collections or role tables keep the stacked layout).
 */
export function collectionTableModel(node: CollectionNode): CollectionTableModel | null {
  if (!node.items.length) return null;
  const first = node.items[0] as CollectionItemView;
  if (!first.children.length || !first.children.every((c) => c.type === 'leaf')) return null;
  const columns = (first.children as LeafNode[]).map((c) => ({ template: c.template, label: c.entry.name }));
  const sig = columns.map((c) => c.template).join('|');
  const rows: CollectionTableModel['rows'] = [];
  for (const item of node.items) {
    if (!item.children.every((c) => c.type === 'leaf')) return null;
    const cells = item.children as LeafNode[];
    if (cells.map((c) => c.template).join('|') !== sig) return null;
    rows.push({ item, cells });
  }
  const allRow = columns.map((col) => node.allItems.find((a) => a.template === col.template) ?? null);
  return { columns, rows, allRow };
}
