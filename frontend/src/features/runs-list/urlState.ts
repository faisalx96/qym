/**
 * The runs-list view ⇄ URL codec (brief 03 §2.J2.3, §8 "State placement").
 * The URL is the whole view (OPEN_QUESTIONS §9.2). Sentinels (`__none__`,
 * `__empty__`, `|||plain|reasoning`) stay on the wire but live only here.
 */
import type { DashboardFilters } from '@/api/dashboardTypes';
import {
  CONTEXT_KEYS,
  DEFAULT_SORT,
  contextFromParams,
  expandModelValues,
  parseLocalDate,
  parseModelKey,
  modelVariantKey,
  normalizeSearch,
  rangeBounds,
  validSort,
  type ContextParams,
  type QuickRange,
} from '@/lib/runs-order';

export type OriginFilter = 'all' | 'official' | 'local';
export const NONE = '__none__';
export const EMPTY = '__empty__';
export const VERSIONING_PREFIX = 'v.';
export const PAGE_SIZE = 50;

export interface RunsView {
  tasks: string[];
  /** Model variant keys (`name|||plain`), or NONE. */
  models: string[];
  datasets: string[];
  statuses: string[];
  versions: string[];
  owners: string[];
  versioning: Record<string, string[]>;
  range: QuickRange;
  from: string;
  to: string;
  origin: OriginFilter;
  q: string;
  sort: string;
  page: number;
}

export const DEFAULT_VIEW: RunsView = {
  tasks: [],
  models: [],
  datasets: [],
  statuses: [],
  versions: [],
  owners: [],
  versioning: {},
  range: 'all',
  from: '',
  to: '',
  origin: 'all',
  q: '',
  sort: DEFAULT_SORT,
  page: 1,
};

const LIST_KEYS: readonly (readonly [
  string,
  keyof Pick<RunsView, 'tasks' | 'models' | 'datasets' | 'statuses' | 'versions' | 'owners'>,
])[] = [
  ['task', 'tasks'],
  ['model', 'models'],
  ['dataset', 'datasets'],
  ['status', 'statuses'],
  ['version', 'versions'],
  ['owner', 'owners'],
];

function uniq(values: string[]): string[] {
  return values.filter((v, i) => v && values.indexOf(v) === i);
}

export function parseView(params: URLSearchParams): RunsView {
  const view: RunsView = { ...DEFAULT_VIEW, versioning: {} };
  for (const [param, field] of LIST_KEYS) {
    const values = uniq(params.getAll(param));
    view[field] = param === 'model' ? expandModelValues(values) : values;
  }
  for (const [key, value] of params.entries()) {
    if (!key.startsWith(VERSIONING_PREFIX) || key.length <= VERSIONING_PREFIX.length || !value) continue;
    const name = key.slice(VERSIONING_PREFIX.length);
    view.versioning[name] = uniq([...(view.versioning[name] ?? []), value]);
  }
  const range = params.get('range');
  const from = parseLocalDate(params.get('from')) ? params.get('from')! : '';
  const to = parseLocalDate(params.get('to')) ? params.get('to')! : '';
  if (range === 'custom' && (from || to)) {
    view.range = 'custom';
    view.from = from;
    view.to = to;
  } else {
    view.range = range === 'today' || range === 'week' || range === 'month' ? range : 'all';
  }
  const origin = params.get('origin');
  view.origin = origin === 'official' || origin === 'local' ? origin : 'all';
  view.q = normalizeSearch(params.get('q'));
  view.sort = validSort(params.get('sort'));
  const page = parseInt(params.get('page') ?? '', 10);
  view.page = Number.isFinite(page) && page > 1 ? page : 1;
  return view;
}

/** Collapse `name|||plain` + `name|||reasoning` back to the plain name. */
export function modelUrlValues(models: string[]): string[] {
  const set = new Set(models);
  const out: string[] = [];
  for (const key of models) {
    const parsed = parseModelKey(key);
    if (parsed.reasoning === null) {
      out.push(key);
      continue;
    }
    const plain = modelVariantKey(parsed.name, false);
    const reasoning = modelVariantKey(parsed.name, true);
    if (set.has(plain) && set.has(reasoning)) {
      if (!out.includes(parsed.name)) out.push(parsed.name);
    } else out.push(key);
  }
  return out;
}

/** The URL of a view (canonical key order, page only when > 1, sort only when non-default). */
export function viewToParams(view: RunsView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.range !== 'all') out.set('range', view.range);
  if (view.range === 'custom') {
    if (view.from) out.set('from', view.from);
    if (view.to) out.set('to', view.to);
  }
  for (const [param, field] of LIST_KEYS) {
    const values = param === 'model' ? modelUrlValues(view.models) : view[field];
    for (const v of values) out.append(param, v);
  }
  if (view.origin !== 'all') out.set('origin', view.origin);
  if (view.q) out.set('q', view.q);
  if (view.sort !== DEFAULT_SORT) out.set('sort', view.sort);
  if (view.page > 1) out.set('page', String(view.page));
  for (const key of Object.keys(view.versioning).sort()) {
    for (const v of view.versioning[key] ?? []) out.append(VERSIONING_PREFIX + key, v);
  }
  return out;
}

/** Query-string keys that belong to the view (used to replace the URL wholesale). */
export function viewKeys(params: URLSearchParams): string[] {
  const keys = new Set<string>([...CONTEXT_KEYS, 'page']);
  for (const key of params.keys()) if (key.startsWith(VERSIONING_PREFIX)) keys.add(key);
  return [...keys];
}

/** Dashboard API filters of a view (local-day range bounds → ISO). */
export function viewToFilters(view: RunsView, now: Date = new Date()): DashboardFilters {
  const filters: DashboardFilters = {
    tasks: view.tasks,
    models: view.models,
    datasets: view.datasets,
    statuses: view.statuses,
    versions: view.versions,
    users: view.owners,
  };
  const bounds = rangeBounds(view.range, view.from, view.to, now);
  if (bounds.since) filters.since = bounds.since.toISOString();
  if (bounds.until) filters.until = bounds.until.toISOString();
  if (view.origin !== 'all') filters.origins = [view.origin];
  const versioning = Object.fromEntries(Object.entries(view.versioning).filter(([, v]) => v.length));
  if (Object.keys(versioning).length) filters.versioning = versioning;
  if (view.q) filters.q = view.q;
  return filters;
}

/** The `?list=` context a run link carries (legacy keys only, no page). */
export function contextForView(view: RunsView): string {
  const params: ContextParams = {
    range: view.range !== 'all' ? view.range : null,
    from: view.range === 'custom' ? view.from : null,
    to: view.range === 'custom' ? view.to : null,
    task: view.tasks,
    model: modelUrlValues(view.models),
    dataset: view.datasets,
    status: view.statuses,
    version: view.versions,
    owner: view.owners,
    origin: view.origin !== 'all' ? view.origin : null,
    q: view.q,
    sort: view.sort,
  };
  return contextFromParams(params);
}

export function activeVersioningFilters(view: RunsView): [string, string[]][] {
  return Object.entries(view.versioning).filter(([, v]) => v.length > 0);
}

export function countActiveFilters(view: RunsView): number {
  let n = 0;
  for (const [, field] of LIST_KEYS) if (view[field].length) n++;
  if (view.range !== 'all') n++;
  if (view.origin !== 'all') n++;
  n += activeVersioningFilters(view).length;
  if (view.q) n++;
  return n;
}

/** The key everything except sort/page is derived from (resets the page). */
export function filterKey(view: RunsView): string {
  const { sort: _sort, page: _page, ...rest } = view;
  void _sort;
  void _page;
  return JSON.stringify(rest);
}

export function isEmptyFilterValue(value: string): boolean {
  return value === EMPTY || value === '';
}

export function statusLabel(status: string): string {
  if (isEmptyFilterValue(status)) return 'Empty / Missing';
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** `claude-sonnet-4 (reasoning)` */
export function modelOptionLabel(key: string): string {
  const parsed = parseModelKey(key);
  if (key === NONE) return 'None';
  if (isEmptyFilterValue(parsed.name) || parsed.name === 'nomodel') return 'Empty / Missing';
  return parsed.reasoning ? `${parsed.name} (reasoning)` : parsed.name;
}

export function versioningKeyWords(key: string): string {
  return key.replace(/[_.-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function customRangeLabel(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return 'custom range';
}

function summarize(values: string[], label: (v: string) => string = (v) => v, max = 2): string {
  const shown = values.slice(0, max).map(label);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

/** The status-bar sentence: "8 of 43 runs — task: rag-qa, status: Completed". */
export function filterSummary(
  view: RunsView,
  counts: { total: number; filtered: number },
  labels: { owner?: (id: string) => string; dataset?: (v: string) => string } = {},
): string {
  const countText =
    counts.filtered === counts.total ? `${counts.total} runs` : `${counts.filtered} of ${counts.total} runs`;
  if (!countActiveFilters(view)) return countText;
  const parts: string[] = [];
  const has = (v: string[]) => v.length > 0 && !v.includes(NONE);
  if (has(view.tasks)) parts.push(`task: ${summarize(view.tasks)}`);
  if (has(view.datasets)) parts.push(`dataset: ${summarize(view.datasets, labels.dataset)}`);
  if (has(view.models)) parts.push(`model: ${summarize(modelUrlValues(view.models), modelOptionLabel)}`);
  else if (view.models.includes(NONE)) parts.push('model: none');
  if (has(view.statuses)) parts.push(`status: ${summarize(view.statuses, statusLabel)}`);
  if (has(view.versions)) parts.push(`version: ${summarize(view.versions)}`);
  if (has(view.owners)) parts.push(`user: ${summarize(view.owners, labels.owner)}`);
  else if (view.owners.includes(NONE)) parts.push('user: none');
  for (const [key, values] of activeVersioningFilters(view))
    parts.push(`${versioningKeyWords(key)}: ${summarize(values)}`);
  if (view.origin === 'official') parts.push('official runs');
  if (view.origin === 'local') parts.push('local runs');
  if (view.q) parts.push(`search: "${view.q}"`);
  if (view.range === 'today') parts.push('today');
  if (view.range === 'week') parts.push('last 7d');
  if (view.range === 'month') parts.push('last 30d');
  if (view.range === 'custom') parts.push(customRangeLabel(view.from, view.to));
  return parts.length ? `${countText} — ${parts.join(', ')}` : countText;
}

/** Structured sort: `metric-<name>` names may contain '-', so parse from the end. */
export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export function parseSort(sort: string): SortSpec {
  const m = /^(.*)-(asc|desc)$/.exec(sort);
  if (!m) return { field: 'time', direction: 'desc' };
  return { field: m[1]!, direction: m[2] as 'asc' | 'desc' };
}

export function sortString(spec: SortSpec): string {
  return `${spec.field}-${spec.direction}`;
}

const TEXT_SORT_FIELDS = new Set(['task', 'model', 'dataset', 'version', 'owner', 'run']);

/** First click: desc for numeric/time/status/latency/duration/metric/trace, asc for text. */
export function defaultDirection(field: string): 'asc' | 'desc' {
  return TEXT_SORT_FIELDS.has(field) ? 'asc' : 'desc';
}
