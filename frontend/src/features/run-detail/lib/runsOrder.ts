/**
 * The Runs list order outside the list (runs_order.js, C044): the `?list=`
 * context a run link carries, the dashboard filters/sort it maps to, and the
 * browser collation of text sorts the pager needs.
 */
export const LIST_PARAM = 'list';
export const DEFAULT_SORT = 'time-desc';

const FILTERS: Array<[string, string]> = [
  ['task', 'tasks'],
  ['model', 'models'],
  ['dataset', 'datasets'],
  ['status', 'statuses'],
  ['version', 'versions'],
  ['owner', 'users'],
];
const CONTEXT_KEYS = [
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
];
const SINGLE_KEYS = new Set(['q', 'sort', 'origin', 'range', 'from', 'to']);
const ORIGINS = ['official', 'local'];
const COLLATED: Record<string, string> = {
  task: 'tasks',
  model: 'models',
  dataset: 'dataset_names',
  version: 'git_commits',
  owner: 'owner_names',
};

function sortField(sort: string | null | undefined): string {
  return String(sort ?? '').replace(/-(asc|desc)$/, '');
}

export function validSort(sort: string | null | undefined): string {
  return typeof sort === 'string' && /^[^\s].*-(asc|desc)$/.test(sort) ? sort : DEFAULT_SORT;
}

function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export type ContextParams = Record<string, string | string[] | null | undefined>;

export function contextFromParams(params: ContextParams): string {
  const out = new URLSearchParams();
  CONTEXT_KEYS.forEach((key) => {
    let value = params[key];
    if (key === 'q') value = normalizeSearch(value);
    if (key === 'sort' && value === DEFAULT_SORT) value = null;
    (Array.isArray(value) ? value : [value]).forEach((item) => {
      if (item !== null && item !== undefined && item !== '') out.append(key, String(item));
    });
  });
  return out.toString();
}

export function normalizeContext(context: string | null | undefined): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(context ?? ''));
  } catch {
    return '';
  }
  const source: ContextParams = {};
  CONTEXT_KEYS.forEach((key) => {
    const values = params.getAll(key);
    if (values.length) source[key] = SINGLE_KEYS.has(key) ? values[0] : values;
  });
  return contextFromParams(source);
}

export function runHref(base: string, context: string | null | undefined): string {
  const normalized = normalizeContext(context);
  if (!normalized) return base;
  return base + '?' + new URLSearchParams([[LIST_PARAM, normalized]]).toString();
}

function parseLocalDate(value: unknown): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function rangeBounds(range: string | null, from: string | null, to: string | null, now?: Date) {
  let since: Date | null = null;
  let until: Date | null = null;
  const at = now ?? new Date();
  if (range === 'today') {
    since = new Date(at);
    since.setHours(0, 0, 0, 0);
    until = new Date(since);
    until.setDate(until.getDate() + 1);
  } else if (range === 'week' || range === 'month') {
    since = new Date(at);
    since.setDate(since.getDate() - (range === 'week' ? 7 : 30));
  } else if (range === 'custom') {
    since = parseLocalDate(from);
    until = parseLocalDate(to);
    if (until) until.setDate(until.getDate() + 1);
  }
  return { since, until };
}

export interface NeighborQuery {
  filters: Record<string, unknown>;
  sort: string;
}

/** The dashboard API filters and sort of a list context, as the list sends them. */
export function neighborQuery(context: string | null | undefined, now?: Date): NeighborQuery {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(String(context ?? ''));
  } catch {
    params = new URLSearchParams();
  }
  const filters: Record<string, unknown> = {};
  FILTERS.forEach(([key, target]) => {
    let values = params.getAll(key).filter(Boolean);
    if (key === 'model') {
      const models: string[] = [];
      values.forEach((value) => {
        if (value === '__none__' || /\|\|\|(reasoning|plain)$/.test(value)) models.push(value);
        else models.push(value + '|||plain', value + '|||reasoning');
      });
      values = models;
    }
    filters[target] = values.filter((v, i) => values.indexOf(v) === i);
  });
  const bounds = rangeBounds(params.get('range'), params.get('from'), params.get('to'), now);
  if (bounds.since) filters.since = bounds.since.toISOString();
  if (bounds.until) filters.until = bounds.until.toISOString();
  const origin = params.get('origin');
  if (origin && ORIGINS.includes(origin)) filters.origins = [origin];
  const search = normalizeSearch(params.get('q'));
  if (search) filters.q = search;
  return { filters, sort: validSort(params.get('sort')) };
}

function parseModelKey(value: string): { name: string; reasoning: boolean | null } {
  const raw = String(value ?? '');
  const index = raw.lastIndexOf('|||');
  const suffix = index < 0 ? '' : raw.slice(index + 3);
  if (suffix !== 'reasoning' && suffix !== 'plain') return { name: raw, reasoning: null };
  return { name: raw.slice(0, index), reasoning: suffix === 'reasoning' };
}

function stripProvider(name: string): string {
  const slash = String(name ?? '').indexOf('/');
  return slash > 0 ? name.slice(slash + 1) : String(name ?? '');
}

export function compareModelKeys(a: string, b: string): number {
  const left = parseModelKey(a);
  const right = parseModelKey(b);
  const byLabel = stripProvider(left.name).localeCompare(stripProvider(right.name));
  if (byLabel !== 0) return byLabel;
  if (!!left.reasoning === !!right.reasoning) return 0;
  return left.reasoning ? 1 : -1;
}

export function collatedColumn(sort: string): string | null {
  const field = sortField(sort);
  return Object.prototype.hasOwnProperty.call(COLLATED, field) ? COLLATED[field]! : null;
}

/** The browser-collated order of a text sort's values; null when the server orders itself. */
export function collation(sort: string, values: string[] | null | undefined): string[] | null {
  if (!collatedColumn(sort)) return null;
  const field = sortField(sort);
  const compare =
    field === 'model' ? compareModelKeys : (a: string, b: string) => String(a).localeCompare(String(b));
  return (values ?? []).slice().sort((a, b) => {
    const left = String(a);
    const right = String(b);
    return compare(a, b) || (left < right ? -1 : left > right ? 1 : 0);
  });
}
