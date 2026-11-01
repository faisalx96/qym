/** Project live evaluation reads; metric names and worker evidence are producer-defined. */
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { platformUrl } from '@/lib/runtime';

export interface LiveSourceInfo {
  id: string;
  key: string;
  name: string;
  environment: string;
  product: string | null;
  stale: boolean;
  seconds_since_heartbeat: number | null;
  last_heartbeat_at: string | null;
  last_turn_at: string | null;
  worker: Record<string, unknown>;
}

export interface LiveMetricSpec {
  metric_name: string;
  group: string;
  label: string;
  score_type: 'percentage' | 'boolean' | 'numeric' | 'categorical' | 'duration';
  direction: 'maximize' | 'minimize' | null;
  pass_threshold: number | null;
  unit: string | null;
  precision: number | null;
  is_primary: boolean;
  position: number;
  description: string | null;
  values: Record<string, unknown>[] | null;
}

export interface LiveDay {
  id: string;
  source_id: string;
  day: string;
  run_ref: string | null;
  status: 'running' | 'closed';
  turns_seen: number;
  evaluated: number;
  failed: number;
  incomplete: number;
  excluded: number;
  first_poll_at: string | null;
  last_poll_at: string | null;
  closed_at: string | null;
  polls: number;
  max_poll_gap_s: number;
  parameters: Record<string, unknown>;
}

export interface LiveOverview {
  status: LiveSourceInfo;
  day: {
    row: LiveDay | null;
    in_qym: number;
    not_in_qym: number;
    label_mix: Record<string, number>;
    metric_means: { metric_name: string; mean: number | null; n: number; spec: LiveMetricSpec }[];
    services: { name: string; ok_rate: number; n: number; fault_breakdown: Record<string, number> }[];
    latency: { median_ms: number | null; p90_ms: number | null; over_5min: number };
    worker_gap_s: number;
  };
  canaries: {
    canary: string;
    status: 'ok' | 'failed' | 'skipped';
    fault: string | null;
    latency_ms: number | null;
    checked_at: string;
  }[];
  trend: {
    day: string;
    turns: number;
    counts_by_label: Record<string, number>;
    primary_rate: number | null;
    worker_gap: boolean;
  }[];
  days: {
    rows: (Pick<
      LiveDay,
      'day' | 'status' | 'turns_seen' | 'evaluated' | 'failed' | 'polls' | 'max_poll_gap_s'
    > & {
      in_qym: number;
      primary_rate: number | null;
      label_mix: Record<string, number>;
      worker_gap: boolean;
    })[];
    total: number;
    page: number;
    page_size: number;
  };
  specs: LiveMetricSpec[];
  primary_metric: string | null;
}

interface LiveTurnColumns {
  turn_id: string;
  turn_at: string;
  day: string;
  question: string;
  mode: string | null;
  label: string | null;
  label_reason: string | null;
  status: 'completed' | 'failed' | 'incomplete_ingest';
  outcome: string | null;
  latency_ms: number | null;
  result_rows: number | null;
  user_ref: string | null;
  conversation_id: string | null;
  turn_index: number | null;
}

export interface LiveTurnRow extends LiveTurnColumns {
  charts: { count: number; failed: number };
  services_not_ok: { name: string; fault: string | null }[];
  scores: Record<string, { score_numeric: number | null; label: string | null; skipped: boolean }>;
}

export interface LiveTurnsPage {
  rows: LiveTurnRow[];
  total: number;
  facets: {
    labels: Record<string, number>;
    modes: Record<string, number>;
    services: Record<string, number>;
    users: { user_ref: string; n: number }[];
  };
}

export interface LiveTurnDetail {
  turn: LiveTurnColumns & {
    id: number;
    source_id: string;
    evaluated_at: string | null;
    received_at: string;
    answer: string | null;
    sql: Record<string, unknown>[];
    tool_calls: number | null;
    trace_url: string | null;
    eval_trace_url: string | null;
    summary: Record<string, unknown>;
    detail: Record<string, unknown> | null;
    rejected: string[] | null;
  };
  summary: Record<string, unknown>;
  detail: Record<string, unknown> | null;
  scores: {
    id: number;
    turn_pk: number;
    metric_name: string;
    score_numeric: number | null;
    score_raw: unknown;
    label: string | null;
    explanation: string | null;
    meta: Record<string, unknown>;
    skipped: boolean;
    skip_reason: string | null;
    spec: LiveMetricSpec | null;
  }[];
  conversation: (Pick<LiveTurnColumns, 'turn_id' | 'turn_at' | 'turn_index' | 'question' | 'label'> & {
    current: boolean;
  })[];
  specs: LiveMetricSpec[];
}

export interface LiveFilters {
  day?: string;
  from?: string;
  to?: string;
  labels?: string[];
  statuses?: string[];
  outcomes?: string[];
  modes?: string[];
  metric?: string;
  min?: number;
  max?: number;
  service?: string;
  service_status?: string;
  charts?: string;
  user?: string;
  conversation?: string;
  q?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

const repeatedFilters = { label: 'labels', status: 'statuses', outcome: 'outcomes', mode: 'modes' } as const;
const stringFilters = [
  'day',
  'from',
  'to',
  'metric',
  'service',
  'service_status',
  'charts',
  'user',
  'conversation',
  'q',
  'sort',
] as const;
const numberFilters = ['min', 'max', 'page', 'page_size'] as const;

export function parseLiveFilters(params: URLSearchParams): LiveFilters {
  const filters: LiveFilters = {};
  for (const [key, field] of Object.entries(repeatedFilters)) filters[field] = params.getAll(key);
  for (const key of stringFilters) {
    const values = params.getAll(key);
    const value = values.at(-1);
    if (value) filters[key] = value;
  }
  for (const key of numberFilters) {
    const value = params.getAll(key).at(-1);
    if (value?.trim() && Number.isFinite(Number(value))) filters[key] = Number(value);
  }
  return filters;
}

export function liveTurnsQuery(filters: LiveFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, field] of Object.entries(repeatedFilters)) {
    for (const value of filters[field] ?? []) params.append(key, value);
  }
  for (const key of stringFilters) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  for (const key of numberFilters) {
    const value = filters[key];
    if (value !== undefined && Number.isFinite(value)) params.set(key, String(value));
  }
  return params;
}

function livePath(slug: string, sub = '', params = new URLSearchParams()): string {
  const query = params.toString();
  return `/api/projects/${encodeURIComponent(slug)}/live${sub}${query ? `?${query}` : ''}`;
}

function sourceQuery(source?: string | null): URLSearchParams {
  return new URLSearchParams(source ? { source } : {});
}

export function useLiveSources(slug: string) {
  return useQuery({
    queryKey: ['project', slug, 'live', 'sources'],
    queryFn: () => api.get<{ sources: LiveSourceInfo[]; default_source: string | null }>(livePath(slug)),
  });
}

interface LiveOverviewOptions {
  source?: string | null;
  day?: string;
  trendDays?: number;
  daysPage?: number;
}

export function liveOverviewQueryOptions(slug: string, options: LiveOverviewOptions) {
  const { source, day, trendDays, daysPage } = options;
  const params = sourceQuery(source);
  if (day) params.set('day', day);
  if (trendDays !== undefined) params.set('trend_days', String(trendDays));
  if (daysPage !== undefined) params.set('days_page', String(daysPage));
  return queryOptions({
    queryKey: ['project', slug, 'live', 'overview', options],
    queryFn: () => api.get<LiveOverview>(livePath(slug, '/overview', params)),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useLiveOverview(slug: string, options: LiveOverviewOptions) {
  return useQuery(liveOverviewQueryOptions(slug, options));
}

export function useLiveTurns(slug: string, filters: LiveFilters, source?: string | null) {
  const params = liveTurnsQuery(filters);
  if (source) params.set('source', source);
  return useQuery({
    queryKey: ['project', slug, 'live', 'turns', source, filters],
    queryFn: () => api.get<LiveTurnsPage>(livePath(slug, '/turns', params)),
    placeholderData: keepPreviousData,
  });
}

export function useLiveTurn(slug: string, turnId: string, source?: string | null) {
  return useQuery({
    queryKey: ['project', slug, 'live', 'turn', source, turnId],
    queryFn: () =>
      api.get<LiveTurnDetail>(
        livePath(slug, `/turns/${turnId.split('/').map(encodeURIComponent).join('/')}`, sourceQuery(source)),
      ),
  });
}

export function liveTurnsCsvUrl(slug: string, filters: LiveFilters, source?: string | null): string {
  const params = liveTurnsQuery(filters);
  if (source) params.set('source', source);
  return platformUrl(livePath(slug, '/turns.csv', params));
}
