/** Version resolution and catalog state lines (pure). */
import type { Dataset, DatasetVersion } from '@/api/datasets';

/**
 * `?v=` as alias → as label → production alias → newest published → newest.
 * Versions arrive newest first.
 */
export function resolveActiveVersion(versions: DatasetVersion[], want: string | null): DatasetVersion | null {
  if (!versions.length) return null;
  if (want) {
    const byAlias = versions.find((v) => (v.aliases ?? []).includes(want));
    if (byAlias) return byAlias;
    const byLabel = versions.find((v) => v.version === want);
    if (byLabel) return byLabel;
  }
  const prod = versions.find((v) => (v.aliases ?? []).includes('production'));
  if (prod) return prod;
  const published = versions.find((v) => v.status === 'published');
  return published ?? versions[0] ?? null;
}

export function isProduction(v: DatasetVersion | null | undefined): boolean {
  return Boolean(v && (v.aliases ?? []).includes('production'));
}

export function versionNumber(label: string | null | undefined): number {
  const m = /^v(\d+)$/.exec(String(label ?? ''));
  return m ? parseInt(m[1] ?? '0', 10) : 0;
}

/** Catalog card state line: `v3 prod · v4 draft`, `v2 draft · never published`, `empty`. */
/** A version's status in words (C168): Production in full, then Draft or Published. */
export function versionStatusLabel(v: DatasetVersion): 'Production' | 'Draft' | 'Published' {
  return isProduction(v) ? 'Production' : v.status === 'draft' ? 'Draft' : 'Published';
}

/**
 * The versions a catalog card names (C168): the production version, then the newest one when it is another. Each
 * carries its own status mark (VersionBadge); the production one is marked production even when the card's summary
 * of it lists no aliases.
 */
export function catalogStateVersions(d: Dataset): DatasetVersion[] {
  const prod = d.production_version;
  const latest = d.latest_version;
  const out: DatasetVersion[] = [];
  if (prod) out.push({ ...prod, aliases: [...new Set([...(prod.aliases ?? []), 'production'])] });
  if (latest && (!prod || latest.id !== prod.id))
    out.push({ ...latest, aliases: (latest.aliases ?? []).filter((a) => a !== 'production') });
  return out;
}

/** The catalog card's version line in words: 'v1 Production · v3 Draft' (no 'prod', no 'current'). */
export function catalogStateLine(d: Dataset): string {
  const versions = catalogStateVersions(d);
  if (!versions.length) return 'empty';
  const parts = versions.map((v) => `${v.version} ${versionStatusLabel(v)}`);
  if (!d.production_version && d.latest_version?.status === 'draft') parts.push('never published');
  return parts.join(' · ');
}

export function catalogVersionCount(d: Dataset): number {
  return versionNumber(d.latest_version?.version);
}

export function catalogItemCount(d: Dataset): number {
  return d.production_version?.item_count ?? d.latest_version?.item_count ?? 0;
}

export type CatalogSort = 'updated_desc' | 'name_asc' | 'items_desc' | 'runs_desc';

export const CATALOG_SORTS: { key: CatalogSort; label: string }[] = [
  { key: 'updated_desc', label: 'Last updated' },
  { key: 'name_asc', label: 'Name A→Z' },
  { key: 'items_desc', label: 'Items (most)' },
  { key: 'runs_desc', label: 'Runs (most)' },
];

export function sortCatalog(list: Dataset[], sort: CatalogSort): Dataset[] {
  const out = [...list];
  switch (sort) {
    case 'name_asc':
      out.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'items_desc':
      out.sort((a, b) => catalogItemCount(b) - catalogItemCount(a) || a.name.localeCompare(b.name));
      break;
    case 'runs_desc':
      out.sort((a, b) => b.run_count - a.run_count || a.name.localeCompare(b.name));
      break;
    default:
      out.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.name.localeCompare(b.name));
  }
  return out;
}

export function filterCatalog(list: Dataset[], query: string): Dataset[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.slug.toLowerCase().includes(q) ||
      (d.description ?? '').toLowerCase().includes(q),
  );
}

export const PRODUCTION_RULE =
  'Only project managers can move the production alias; the creator may set it the first time.';
export const DELETE_RULE = 'Only the dataset creator or a project manager can delete a dataset.';
export const RESTORE_RULE = 'Only project managers can restore a deleted dataset.';
