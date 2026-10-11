/**
 * /projects/:slug/datasets[/*] URL contract (brief 07 §8). The dataset ref is a
 * `:path` on the server, so everything after `datasets/` up to an optional
 * trailing `/compare` is the ref.
 */
export type DetailTab = 'items' | 'runs' | 'lineage' | 'settings';
export type ItemTab = 'details' | 'runs' | 'history';
export const DETAIL_TABS: DetailTab[] = ['items', 'runs', 'lineage', 'settings'];
export const ITEM_TABS: ItemTab[] = ['details', 'runs', 'history'];
export const ITEM_PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_ITEM_PAGE_SIZE = 50;

export interface DatasetRoute {
  mode: 'catalog' | 'deleted' | 'detail' | 'item' | 'compare';
  ref: string;
  tab: DetailTab;
  /** `tab=versions` legacy redirect target */
  legacyTab: boolean;
  itemTab: ItemTab;
  version: string | null;
  itemId: string | null;
  /** 0-based (legacy deep links) */
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  label: string;
  q: string;
  catalogSort: string;
  base: string | null;
  head: string | null;
  compareTab: 'changed' | 'added' | 'removed' | 'unchanged';
}

/** `splat` is everything after `/datasets/` (may be '' or undefined). */
export function parseDatasetRoute(splat: string | undefined, params: URLSearchParams): DatasetRoute {
  let rest = (splat ?? '').replace(/^\/+|\/+$/g, '');
  let mode: DatasetRoute['mode'] = 'catalog';
  if (rest.endsWith('/compare')) {
    rest = rest.slice(0, -'/compare'.length);
    mode = 'compare';
  } else if (rest) mode = params.get('item') ? 'item' : 'detail';
  else if (params.get('view') === 'deleted') mode = 'deleted';
  const ref = rest
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');
  const tabRaw = params.get('tab') ?? '';
  const legacyTab = tabRaw === 'versions';
  const tab = (legacyTab ? 'lineage' : DETAIL_TABS.includes(tabRaw as DetailTab) ? tabRaw : 'items') as DetailTab;
  const itemTab = (ITEM_TABS.includes(tabRaw as ItemTab) ? tabRaw : 'details') as ItemTab;
  const page = Math.max(0, parseInt(params.get('page') ?? '0', 10) || 0);
  const sizeRaw = parseInt(params.get('size') ?? '', 10);
  const pageSize = ITEM_PAGE_SIZES.includes(sizeRaw) ? sizeRaw : DEFAULT_ITEM_PAGE_SIZE;
  const compareRaw = params.get('tab') ?? 'changed';
  const compareTab = (['changed', 'added', 'removed', 'unchanged'].includes(compareRaw) ? compareRaw : 'changed') as DatasetRoute['compareTab'];
  return {
    mode,
    ref,
    tab,
    legacyTab,
    itemTab,
    version: params.get('v') || null,
    itemId: params.get('item') || null,
    page,
    pageSize,
    search: params.get('search') ?? '',
    sort: params.get('sort') ?? '',
    label: params.get('label') ?? '',
    q: params.get('q') ?? '',
    catalogSort: params.get('sort') ?? '',
    base: params.get('base') || null,
    head: params.get('head') || null,
    compareTab,
  };
}

export function encodeRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

export function datasetPath(slug: string, ref: string, query?: Record<string, string | number | null | undefined>): string {
  const base = `/projects/${encodeURIComponent(slug)}/datasets/${encodeRef(ref)}`;
  return base + queryString(query);
}

export function comparePath(slug: string, ref: string, query?: Record<string, string | number | null | undefined>): string {
  return `/projects/${encodeURIComponent(slug)}/datasets/${encodeRef(ref)}/compare${queryString(query)}`;
}

export function catalogPath(slug: string, query?: Record<string, string | number | null | undefined>): string {
  return `/projects/${encodeURIComponent(slug)}/datasets${queryString(query)}`;
}

export function queryString(query?: Record<string, string | number | null | undefined>): string {
  if (!query) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Server sort keys for the items table (brief 07 §4). */
export function itemSortKey(columnId: string, direction: 'asc' | 'desc'): string {
  if (columnId.startsWith('metric:')) return `${columnId}:${direction}`;
  const map: Record<string, string> = {
    index: 'index',
    item_id: 'item_id',
    input: 'input',
    expected: 'expected',
    metadata: 'metadata',
    runs: 'runs',
    edits: 'edits',
    latency: 'latency',
    updated: 'updated',
  };
  const key = map[columnId] ?? columnId;
  if (key === 'item_id') return direction === 'asc' ? 'item_id' : 'item_id_desc';
  return `${key}_${direction}`;
}

export function parseItemSort(sort: string): { key: string; direction: 'asc' | 'desc' } | null {
  if (!sort) return null;
  const metric = /^metric:(.+):(asc|desc)$/.exec(sort);
  if (metric) return { key: `metric:${metric[1]}`, direction: metric[2] as 'asc' | 'desc' };
  if (sort === 'item_id') return { key: 'item_id', direction: 'asc' };
  if (sort === 'item_id_desc') return { key: 'item_id', direction: 'desc' };
  const m = /^(index|input|expected|metadata|runs|edits|latency|updated)_(asc|desc)$/.exec(sort);
  if (m) return { key: m[1] ?? '', direction: m[2] as 'asc' | 'desc' };
  return null;
}
