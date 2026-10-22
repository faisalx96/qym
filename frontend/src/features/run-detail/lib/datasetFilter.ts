/** The Dataset filter of a union run: items are told apart by the `qym_*` tags the SDK adds to their metadata. */
import type { Row } from '../types';

/** `support-tickets@v4` (the label of the item ids, QC-11); a local file has no version and keeps its name. */
export function datasetKey(name: string, version: string | null | undefined): string {
  return version ? `${name}@${version}` : name;
}

/** The dataset an item came from, as a filter key; null for an untagged item (a single-dataset run). */
export function rowDatasetKey(row: Row): string | null {
  const md = row.item_metadata;
  if (!md || typeof md !== 'object') return null;
  const name = (md as Record<string, unknown>).qym_dataset;
  if (typeof name !== 'string' || !name) return null;
  const version = (md as Record<string, unknown>).qym_dataset_version;
  return datasetKey(name, typeof version === 'string' && version ? version : null);
}

/** The name and version a key stands for (the version follows the last `@`). */
export function datasetKeyParts(key: string): { name: string; version: string | null } {
  const at = key.lastIndexOf('@');
  return at > 0 ? { name: key.slice(0, at), version: key.slice(at + 1) } : { name: key, version: null };
}

/** `support-tickets v4`: the key as people read it (chips, the select). */
export function datasetKeyLabel(key: string): string {
  const { name, version } = datasetKeyParts(key);
  return version ? `${name} ${version}` : name;
}

/** The raw dataset item id of a union item (`qym_item_id`), else the item id as stored. */
export function rowRawItemId(row: Row): string {
  const md = row.item_metadata as Record<string, unknown> | null | undefined;
  const raw = md && typeof md === 'object' ? md.qym_item_id : null;
  return typeof raw === 'string' && raw ? raw : String(row.item_id);
}
