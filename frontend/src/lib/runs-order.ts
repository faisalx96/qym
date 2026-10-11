/**
 * The Runs list order outside the list (C044) — port of runs_order.js.
 *
 * A run opened from the Runs list carries the list's view (filters, range,
 * search and sort, never the page) in one `list` query parameter; the run
 * page steps prev/next in that order through POST /api/dashboard/neighbors.
 * The wire format is pinned by tests/platform/test_runs_order_js.py, so the
 * key order, the model expansion and the collation rules must not drift.
 */
import type { DashboardFilters } from '@/api/dashboardTypes';

export const LIST_PARAM = 'list';
export const DEFAULT_SORT = 'time-desc';

/** URL filter key → dashboard API filter list. */
export const URL_FILTERS: readonly (readonly [string, keyof DashboardFilters])[] = [
  ['task', 'tasks'],
  ['model', 'models'],
  ['dataset', 'datasets'],
  ['status', 'statuses'],
  ['version', 'versions'],
  ['owner', 'users'],
];

/** The order the list writes its view parameters in (page left out). */
export const CONTEXT_KEYS = [
  'range',
  'from',
  'to',
  'task',
  'model',
  'dataset',
  'status',
  'version',
  'owner',
  'origin',
  'q',
  'sort',
] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
const SCALAR_KEYS = new Set<string>(['q', 'sort', 'origin', 'range', 'from', 'to']);
const ORIGINS = ['official', 'local'];
const COLLATED: Record<string, string> = {
  task: 'tasks',
  model: 'models',
  dataset: 'dataset_names',
  version: 'git_commits',
  owner: 'owner_names',
};

export type ContextParams = Partial<Record<ContextKey, string | string[] | null | undefined>>;

export function sortField(sort: string | null | undefined): string {
  return String(sort ?? '').replace(/-(asc|desc)$/, '');
}

export function validSort(sort: unknown): string {
  return typeof sort === 'string' && /^[^\s].*-(asc|desc)$/.test(sort) ? sort : DEFAULT_SORT;
}

export function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** The list's view parameters as the run link's context ('' for the default view). */
export function contextFromParams(params: ContextParams): string {
  const out = new URLSearchParams();
  for (const key of CONTEXT_KEYS) {
    let value = params[key];
    if (key === 'q') value = normalizeSearch(value);
    if (key === 'sort' && value === DEFAULT_SORT) value = null;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined && item !== '') out.append(key, String(item));
    }
  }
  return out.toString();
}

/** A context read back from a URL: only the list's view keys, in order. */
export function normalizeContext(context: unknown): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(context ?? ''));
  } catch {
    return '';
  }
  const source: ContextParams = {};
  for (const key of CONTEXT_KEYS) {
    const values = params.getAll(key);
    if (values.length) source[key] = SCALAR_KEYS.has(key) ? values[0] : values;
  }
  return contextFromParams(source);
}

/** The run page URL for a run, carrying the list context when there is one. */
export function runHref(base: string, context: string | null | undefined): string {
  const normalized = normalizeContext(context);
  if (!normalized) return base;
  return `${base}?${new URLSearchParams([[LIST_PARAM, normalized]]).toString()}`;
}

export function parseLocalDate(value: unknown): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export type QuickRange = 'all' | 'today' | 'week' | 'month' | 'custom';

/** Local-day bounds of a list range (dashboard.js timeFilterBounds). */
export function rangeBounds(
  range: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  now: Date = new Date(),
): { since: Date | null; until: Date | null } {
  let since: Date | null = null;
  let until: Date | null = null;
  if (range === 'today') {
    since = new Date(now);
    since.setHours(0, 0, 0, 0);
    until = new Date(since);
    until.setDate(until.getDate() + 1);
  } else if (range === 'week' || range === 'month') {
    since = new Date(now);
    since.setDate(since.getDate() - (range === 'week' ? 7 : 30));
  } else if (range === 'custom') {
    since = parseLocalDate(from);
    until = parseLocalDate(to);
    if (until) until.setDate(until.getDate() + 1);
  }
  return { since, until };
}

export interface ParsedModelKey {
  name: string;
  reasoning: boolean | null;
}

export function parseModelKey(value: unknown): ParsedModelKey {
  const raw = String(value ?? '');
  const index = raw.lastIndexOf('|||');
  const suffix = index < 0 ? '' : raw.slice(index + 3);
  if (suffix !== 'reasoning' && suffix !== 'plain') return { name: raw, reasoning: null };
  return { name: raw.slice(0, index), reasoning: suffix === 'reasoning' };
}

export function modelVariantKey(name: string, reasoning: boolean): string {
  return `${name}|||${reasoning ? 'reasoning' : 'plain'}`;
}

export function stripProvider(name: unknown): string {
  const s = String(name ?? '');
  const slash = s.indexOf('/');
  return slash > 0 ? s.slice(slash + 1) : s;
}

/** A plain model name in a URL covers its plain and reasoning variants. */
export function expandModelValues(values: string[]): string[] {
  const models: string[] = [];
  for (const value of values) {
    if (value === '__none__' || /\|\|\|(reasoning|plain)$/.test(value)) models.push(value);
    else models.push(modelVariantKey(value, false), modelVariantKey(value, true));
  }
  return models.filter((v, i) => models.indexOf(v) === i);
}

/** The dashboard API filters and sort of a list context. */
export function queryFromContext(
  context: string | null | undefined,
  now: Date = new Date(),
): { filters: DashboardFilters; sort: string } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(context ?? ''));
  } catch {
    params = new URLSearchParams();
  }
  const filters: DashboardFilters = {};
  for (const [param, field] of URL_FILTERS) {
    let values = params.getAll(param).filter(Boolean);
    if (param === 'model') values = expandModelValues(values);
    (filters as Record<string, unknown>)[field] = values.filter((v, i) => values.indexOf(v) === i);
  }
  const bounds = rangeBounds(params.get('range'), params.get('from'), params.get('to'), now);
  if (bounds.since) filters.since = bounds.since.toISOString();
  if (bounds.until) filters.until = bounds.until.toISOString();
  const origin = params.get('origin');
  if (origin && ORIGINS.includes(origin)) filters.origins = [origin as 'official' | 'local'];
  const search = normalizeSearch(params.get('q'));
  if (search) filters.q = search;
  return { filters, sort: validSort(params.get('sort')) };
}

/** Models sort by the name the list shows (no provider), plain first. */
export function compareModelKeys(a: unknown, b: unknown): number {
  const left = parseModelKey(a);
  const right = parseModelKey(b);
  const byLabel = stripProvider(left.name).localeCompare(stripProvider(right.name));
  if (byLabel !== 0) return byLabel;
  if (Boolean(left.reasoning) === Boolean(right.reasoning)) return 0;
  return left.reasoning ? 1 : -1;
}

/** The overview's sort_values column of a text sort, else null. */
export function collatedColumn(sort: string | null | undefined): string | null {
  const field = sortField(sort);
  return Object.prototype.hasOwnProperty.call(COLLATED, field) ? COLLATED[field]! : null;
}

/**
 * The order of a text sort's values (the server sorts by it); null for a sort
 * the server orders by itself. Ties fall back to code-point order so two lists
 * fetched separately collate alike.
 */
export function collation(sort: string | null | undefined, values: unknown[] | undefined): string[] | null {
  if (!collatedColumn(sort)) return null;
  const field = sortField(sort);
  const compare =
    field === 'model' ? compareModelKeys : (a: unknown, b: unknown) => String(a).localeCompare(String(b));
  return (values ?? []).map((v) => String(v)).sort((a, b) => compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}
