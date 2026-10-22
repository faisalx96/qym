/** Union runs in the local viewer: the source dataset of a row (the SDK's `qym_*` item tags) and the per-dataset scores. */
import type { Row } from '../types';
import { metricCell } from './metric-cell';

export interface DatasetEntry {
  position: number;
  name: string;
  version: string | null;
  /** `name@version` (the filter value and the item id prefix). */
  key: string;
  items: number;
  failed: number;
  means: Array<number | null>;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** The dataset a row came from; null for a row without tags (every file written before multi-dataset runs). */
export function rowDataset(row: Row): { position: number; name: string; version: string | null } | null {
  const md = row.item_metadata;
  if (!md || typeof md !== 'object') return null;
  const name = text(md.qym_dataset);
  const index = md.qym_dataset_index;
  if (!name || typeof index !== 'number') return null;
  return { position: index, name, version: text(md.qym_dataset_version) };
}

export const datasetKey = (name: string, version: string | null): string =>
  version ? `${name}@${version}` : name;

export function rowDatasetKey(row: Row): string | null {
  const d = rowDataset(row);
  return d ? datasetKey(d.name, d.version) : null;
}

export const datasetKeyLabel = (key: string): string => {
  const at = key.lastIndexOf('@');
  return at > 0 ? `${key.slice(0, at)} ${key.slice(at + 1)}` : key;
};

/** The raw dataset item id of a union row. */
export function rowRawItemId(row: Row): string {
  const raw = row.item_metadata?.qym_item_id;
  return typeof raw === 'string' && raw ? raw : String(row.item_id ?? row.index + 1);
}

/** One entry per dataset, in list order, with the scores computed from the rows; [] unless two or more datasets. */
export function datasetEntries(rows: Row[], metricCount: number): DatasetEntry[] {
  const byPosition = new Map<number, DatasetEntry & { sums: number[]; counts: number[] }>();
  for (const row of rows) {
    const d = rowDataset(row);
    if (!d) continue;
    let entry = byPosition.get(d.position);
    if (!entry) {
      entry = {
        position: d.position,
        name: d.name,
        version: d.version,
        key: datasetKey(d.name, d.version),
        items: 0,
        failed: 0,
        means: [],
        sums: Array.from({ length: metricCount }, () => 0),
        counts: Array.from({ length: metricCount }, () => 0),
      };
      byPosition.set(d.position, entry);
    }
    entry.items += 1;
    if (row.status === 'error') entry.failed += 1;
    for (let k = 0; k < metricCount; k++) {
      const num = metricCell(row.metric_values[k]).num;
      if (num !== null) {
        entry.sums[k] = (entry.sums[k] ?? 0) + num;
        entry.counts[k] = (entry.counts[k] ?? 0) + 1;
      }
    }
  }
  const entries = Array.from(byPosition.values()).sort((a, b) => a.position - b.position);
  if (entries.length < 2) return [];
  return entries.map(({ sums, counts, ...entry }) => ({
    ...entry,
    means: sums.map((sum, k) => ((counts[k] ?? 0) > 0 ? sum / (counts[k] ?? 1) : null)),
  }));
}
