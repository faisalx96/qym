/**
 * Run detail API hooks (brief 04 §4). Cookie auth through `api`; every
 * fetcher throws ApiError on failure. `GET /api/runs/{id}` answers 200
 * `{error}` for not-found/denied: the fetcher classifies that envelope into a
 * 404/403 ApiError so ErrorState works unchanged (OPEN_QUESTIONS 2026-10-11).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import type { RunRow, RunsPage } from '@/api/dashboardTypes';
import type {
  CategoryCatalog,
  DatasetBreakdown,
  GroupMetricsPayload,
  ItemDetailsPayload,
  ItemReasonsPayload,
  ItemSearchCondition,
  ItemSearchPayload,
  LiveStatus,
  NeighborsPayload,
  PassesPayload,
  ReviewHistoryPayload,
  Row,
  RowGroup,
  RowMutationResult,
  RunPayload,
  StepLatencyPayload,
  TracePayload,
} from '@/features/run-detail/types';
import { mergeRow, reuseRows } from '@/features/run-detail/lib/rowSignature';

export const encodeRunId = (runId: string) => runId.split('/').map(encodeURIComponent).join('/');
const runUrl = (runId: string, suffix = '') => `/api/runs/${encodeRunId(runId)}${suffix}`;

export const runKeys = {
  all: (runId: string) => ['run', runId] as const,
  summary: (runId: string) => ['run', runId, 'summary'] as const,
  /** The rows store: stage 2 (CORE_GROUPS) plus every group merged in later. */
  compact: (runId: string) => ['run', runId, 'compact'] as const,
  /** One extra group on its way into the store. */
  rows: (runId: string, group: RowGroup) => ['run', runId, 'rows', group] as const,
  live: (runId: string) => ['run', runId, 'live-status'] as const,
  passes: (runId: string) => ['run', runId, 'passes'] as const,
  datasets: (runId: string, pass: number | null) => ['run', runId, 'datasets', pass] as const,
  groupMetrics: (runId: string, metric: string, threshold: number) =>
    ['run', runId, 'group-metrics', metric, threshold] as const,
  stepLatency: (runId: string, pass: number | null) => ['run', runId, 'step-latency', pass] as const,
  reviewHistory: (runId: string) => ['run', runId, 'review-history'] as const,
  neighbors: (runId: string, slug: string, context: string) =>
    ['run', runId, 'neighbors', slug, context] as const,
  itemDetails: (runId: string, ids: string[]) => ['run', runId, 'item-details', ids] as const,
  itemSearch: (runId: string, field: string, value: string, pass: number | null) =>
    ['run', runId, 'item-search', field, value, pass] as const,
  itemReasons: (runId: string, metric: string, pass: number | null, ids: string[]) =>
    ['run', runId, 'item-reasons', metric, pass, ids] as const,
  itemTrace: (runId: string, itemId: string, pass: number | null) =>
    ['run', runId, 'item-trace', itemId, pass] as const,
  catalog: (slug: string) => ['project', slug, 'category-catalog'] as const,
};

/** 200 `{error}` → ApiError with the status the message implies. */
export function classifyEnvelope<T extends { error?: string }>(data: T): T {
  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
    const msg = data.error;
    const lower = msg.toLowerCase();
    const status = /not found|no such|does not exist|deleted/.test(lower)
      ? 404
      : /denied|forbidden|no access|not allowed|permission/.test(lower)
        ? 403
        : 400;
    throw new ApiError(status, msg, { body: data });
  }
  return data;
}

export async function fetchRunCompact(runId: string): Promise<RunPayload> {
  const data = await api.get<RunPayload & { error?: string }>(runUrl(runId, '?view=compact'));
  return classifyEnvelope(data);
}

/* ── staged loading (perf round 6) ─────────────────────────────────────────────────────────────
 * Stage 0: the header from the runs list cache (placeholder). Stage 1: `?view=summary` (about 1.5 kB gzip).
 * Stage 2: the rows of CORE_GROUPS (everything the report sections read except the item texts). Stage 3: the
 * `text` group, when the Items section is near. Every response is merged into one rows store by item id. */

/** Row groups of the first rows request: scores, reasons (metric meta), item metadata, trace stats and review state. */
export const CORE_GROUPS: RowGroup[] = ['scores', 'reasons', 'categories', 'traces', 'review'];
/** Groups loaded on demand, when a section that reads them is near. */
export const LATE_GROUPS: RowGroup[] = ['text'];

export async function fetchRunSummary(runId: string, signal?: AbortSignal): Promise<RunPayload> {
  const data = await api.get<RunPayload & { error?: string }>(runUrl(runId, '?view=summary'), { signal });
  return classifyEnvelope(data);
}

export async function fetchRunRows(
  runId: string,
  groups: RowGroup[],
  signal?: AbortSignal,
): Promise<RunPayload> {
  const data = await api.get<RunPayload & { error?: string }>(
    runUrl(runId, `?view=compact&fields=${groups.join(',')}`),
    { signal },
  );
  return classifyEnvelope(data);
}

/** The groups a payload's rows carry (a full payload carries all of them). */
export function loadedGroups(payload: RunPayload | undefined): RowGroup[] {
  return payload?.snapshot.row_fields ?? [...CORE_GROUPS, ...LATE_GROUPS];
}

/** A run header from a row of the runs list: what stage 0 paints before any request answers. */
export function runFromListRow(row: RunRow, project?: RunPayload['run']['project']): RunPayload['run'] {
  return {
    provisional: true,
    project,
    run_id: row.run_id,
    file_path: row.file_path,
    task_name: row.task_name,
    dataset_name: row.dataset_name,
    dataset_version: row.dataset_version,
    dataset_aliases: row.dataset_aliases,
    dataset_slug: row.dataset_slug,
    // The count reserves the hero's Datasets group before the summary arrives.
    ...(row.dataset_count && row.dataset_count > 1
      ? {
          dataset_count: row.dataset_count,
          datasets: (row.datasets ?? []).map((d, position) => ({
            position,
            dataset: d.dataset,
            dataset_slug: null,
            version: d.version,
            alias: null,
            items: null,
            deleted: false,
          })),
        }
      : {}),
    model_name: row.model_name,
    run_name: row.run_name,
    external_run_id: row.external_run_id,
    metric_names: row.metrics,
    metric_specs: row.metric_specs,
    status: row.status,
    status_reason: row.status_reason,
    stop_requested: row.stop_requested,
    owner: row.owner,
    started_at: row.started_at,
    git_branch: row.git_branch,
    git_commit: row.git_commit,
    trace_stats: row.trace_stats as RunPayload['run']['trace_stats'],
    samples: row.samples,
    last_completed_pass: row.last_completed_pass ?? undefined,
    experiment: row.experiment as RunPayload['run']['experiment'],
    versioning_details: row.versioning_details,
    origin: row.origin,
    error_count: row.error_count,
    execution_count: row.execution_count,
    execution_error_count: row.execution_error_count,
    execution_success_count: row.execution_success_count,
    duration_ms: row.duration_ms,
  };
}

/** The run in any cached page of the runs list of this project (stage 0), or undefined on a cold start. */
export function runRowFromListCache(qc: QueryClient, slug: string, runId: string): RunRow | undefined {
  for (const [, page] of qc.getQueriesData<RunsPage>({ queryKey: ['dashboard', slug, 'runs'] })) {
    const hit =
      page?.rows?.find((r) => r.run_id === runId) ?? page?.pinned_rows?.find((r) => r.run_id === runId);
    if (hit) return hit;
  }
  return undefined;
}

/** Merge the rows of another group request over the store: by item id, new keys added, order of `next`. */
export function mergeRowGroups(previous: RunPayload | undefined, next: RunPayload): RunPayload {
  if (!previous) return next;
  const prevById = new Map(previous.snapshot.rows.map((row) => [row.item_id, row]));
  const rows = next.snapshot.rows.map((row) => {
    const old = prevById.get(row.item_id);
    return old ? { ...old, ...row } : row;
  });
  const groups = [...new Set([...loadedGroups(previous), ...loadedGroups(next)])];
  return { run: next.run, snapshot: { ...next.snapshot, rows, row_fields: groups } };
}

/**
 * Merge a late group into the store. Only the rows' new keys come over: `run` and the rest of the snapshot stay as
 * the page loaded them (a page that is stale must stay stale, e.g. its pass revision, until it reloads the core rows).
 */
export function mergeLateGroup(previous: RunPayload, late: RunPayload): RunPayload {
  const lateById = new Map(late.snapshot.rows.map((row) => [row.item_id, row]));
  const rows = previous.snapshot.rows.map((row) => {
    const more = lateById.get(row.item_id);
    return more ? { ...row, ...more } : row;
  });
  const groups = [...new Set([...loadedGroups(previous), ...loadedGroups(late)])];
  return { ...previous, snapshot: { ...previous.snapshot, rows, row_fields: groups } };
}

export function runSummaryOptions(runId: string) {
  return {
    queryKey: runKeys.summary(runId),
    queryFn: ({ signal }: { signal?: AbortSignal }) => fetchRunSummary(runId, signal),
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  };
}

/** Stage 2. A refetch (a live run) asks for the core groups and every late group already in the store. */
export function runRowsOptions(
  qc: QueryClient,
  runId: string,
  opts: { refetchInterval?: number | false } = {},
) {
  return {
    queryKey: runKeys.compact(runId),
    queryFn: async ({ signal }: { signal?: AbortSignal }) => {
      const prev = qc.getQueryData<RunPayload>(runKeys.compact(runId));
      const late = prev ? loadedGroups(prev).filter((g) => LATE_GROUPS.includes(g)) : [];
      const next = await fetchRunRows(runId, [...CORE_GROUPS, ...late], signal);
      return reuseRows(prev, mergeRowGroups(prev, next));
    },
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    structuralSharing: false,
    refetchInterval: opts.refetchInterval ?? false,
    retry: false,
  } as const;
}

/** Stage 1 and 2 of a run, requested before the page that reads them has loaded (pointer intent, deep link). */
export function prefetchRun(qc: QueryClient, runId: string): void {
  void qc.prefetchQuery(runSummaryOptions(runId));
  void qc.prefetchQuery(runRowsOptions(qc, runId));
}

export function useRunQuery(runId: string, opts: { refetchInterval?: number | false } = {}) {
  const qc = useQueryClient();
  return useQuery(runRowsOptions(qc, runId, opts));
}

export function useRunSummaryQuery(runId: string, slug: string, project?: RunPayload['run']['project']) {
  const qc = useQueryClient();
  return useQuery({
    ...runSummaryOptions(runId),
    // Stage 0: the list row paints the header at once; it is never treated as fresh data.
    placeholderData: () => {
      const row = runRowFromListCache(qc, slug, runId);
      return row
        ? ({
            run: runFromListRow(row, project),
            snapshot: {
              rows: [],
              stats: {},
              rows_total: row.total_items,
              metric_names: row.metrics,
              metric_specs: row.metric_specs,
            },
          } as unknown as RunPayload)
        : undefined;
    },
  });
}

/** One late group on its way into the rows store (stage 3). Aborted when its section leaves the page. */
export function useRowGroupQuery(runId: string, group: RowGroup, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: runKeys.rows(runId, group),
    queryFn: async ({ signal }) => {
      const data = await fetchRunRows(runId, [group], signal);
      qc.setQueryData<RunPayload>(runKeys.compact(runId), (prev) =>
        prev ? mergeLateGroup(prev, data) : prev,
      );
      return true;
    },
    enabled,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
}

export function fetchLiveStatus(runId: string): Promise<LiveStatus> {
  return api.get<LiveStatus>(runUrl(runId, '/live-status'));
}

export function useLiveStatusQuery(runId: string, enabled: boolean, intervalMs: number | false) {
  return useQuery({
    queryKey: runKeys.live(runId),
    queryFn: () => fetchLiveStatus(runId),
    enabled,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
}

/** The per-dataset score breakdown of a union run; requested with the page's core queries, never for a single dataset. */
export function useDatasetBreakdownQuery(runId: string, pass: number | null, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.datasets(runId, pass),
    queryFn: async () =>
      classifyEnvelope(
        await api.get<DatasetBreakdown & { error?: string }>(
          runUrl(runId, `/datasets${pass ? `?pass=${pass}` : ''}`),
        ),
      ),
    enabled,
    staleTime: 10_000,
  });
}

export function usePassesQuery(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.passes(runId),
    queryFn: async () => classifyEnvelope(await api.get<PassesPayload>(runUrl(runId, '/passes'))),
    enabled,
    staleTime: 10_000,
  });
}

export function useGroupMetricsQuery(
  runId: string,
  metric: string | null,
  threshold: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: runKeys.groupMetrics(runId, metric ?? '', threshold),
    queryFn: async () =>
      api.get<GroupMetricsPayload>(
        runUrl(runId, `/group-metrics?metric=${encodeURIComponent(metric ?? '')}&threshold=${threshold}`),
      ),
    enabled: enabled && !!metric,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function fetchItemDetails(runId: string, itemIds: string[]): Promise<ItemDetailsPayload> {
  return api.post<ItemDetailsPayload>(runUrl(runId, '/items/details'), { item_ids: itemIds });
}

export function useItemSearchQuery(
  runId: string,
  conditions: ItemSearchCondition[],
  passNumbers: number[],
  enabled: boolean,
) {
  const sig = JSON.stringify([conditions.map((c) => [c.id, c.field, c.value]), passNumbers]);
  return useQuery({
    queryKey: ['run', runId, 'item-search', sig] as const,
    queryFn: () =>
      api.post<ItemSearchPayload>(runUrl(runId, '/items/search'), {
        conditions,
        ...(passNumbers.length === 1
          ? { pass_number: passNumbers[0] }
          : passNumbers.length > 1
            ? { pass_numbers: passNumbers }
            : {}),
      }),
    enabled: enabled && conditions.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function fetchItemReasons(
  runId: string,
  metric: string,
  itemIds: string[],
  pass: number | null,
): Promise<ItemReasonsPayload> {
  return api.post<ItemReasonsPayload>(runUrl(runId, '/items/reasons'), {
    item_ids: itemIds,
    metric,
    ...(pass ? { pass_number: pass } : {}),
  });
}

export function useItemTraceQuery(runId: string, itemId: string | null, pass: number | null) {
  return useQuery({
    queryKey: runKeys.itemTrace(runId, itemId ?? '', pass),
    queryFn: () =>
      api.get<TracePayload>(
        runUrl(
          runId,
          `/items/${encodeURIComponent(itemId ?? '')}/trace${pass ? `?pass_number=${pass}` : ''}`,
        ),
      ),
    enabled: !!itemId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function stepLatencyUrl(runId: string, pass: number | null, extra = ''): string {
  return `/api/runs/step-latency?run_ids=${encodeURIComponent(runId)}&rollup=site${pass ? `&pass_number=${pass}` : ''}${extra}`;
}

export function useStepLatencyQuery(runId: string, pass: number | null, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.stepLatency(runId, pass),
    queryFn: () => api.get<StepLatencyPayload>(stepLatencyUrl(runId, pass)),
    enabled,
    staleTime: 60_000,
  });
}

export function useReviewHistoryQuery(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: runKeys.reviewHistory(runId),
    queryFn: () => api.get<ReviewHistoryPayload>(runUrl(runId, '/review-history')),
    enabled,
    staleTime: 30_000,
  });
}

export function fetchNeighbors(body: {
  project_slug: string;
  run_id: string;
  filters: Record<string, unknown>;
  sort: string;
  collation?: string[];
}): Promise<NeighborsPayload> {
  return api.post<NeighborsPayload>('/api/dashboard/neighbors', body);
}

export function useCategoryCatalogQuery(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: runKeys.catalog(slug ?? ''),
    queryFn: () =>
      api.get<CategoryCatalog>(`/api/projects/${encodeURIComponent(slug ?? '')}/analysis-category-catalog`),
    enabled: enabled && !!slug,
    staleTime: 5 * 60_000,
  });
}

export function useSaveCategoryCatalog(slug: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.put<CategoryCatalog>(
        `/api/projects/${encodeURIComponent(slug ?? '')}/analysis-category-catalog`,
        body,
      ),
    onSuccess: (data) => qc.setQueryData(runKeys.catalog(slug ?? ''), data),
  });
}

/* ── mutations: every one answers {ok, row}; the row is merged by item_id ── */

export function applyRowToCache(qc: QueryClient, runId: string, row: Row): void {
  qc.setQueryData<RunPayload>(runKeys.compact(runId), (prev) => (prev ? mergeRow(prev, row) : prev));
}

export interface UpdateMetricBody {
  file_path: string;
  row_index: number;
  metric_name: string;
  new_score?: number;
  reset?: boolean;
  pass_number?: number;
  expected_pass_version?: number;
}

export function useUpdateMetric(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMetricBody) => api.post<RowMutationResult>('/api/runs/update_metric', body),
    onSuccess: (res) => {
      if (res?.row) applyRowToCache(qc, runId, res.row);
    },
  });
}

export interface UpdateRootCauseBody {
  run_id: string;
  item_id: string;
  metric_name?: string;
  pass_number?: number;
  expected_pass_version?: number;
  [key: string]: unknown;
}

export function useUpdateRootCause(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRootCauseBody) =>
      api.post<RowMutationResult>('/api/runs/update_root_cause', body),
    onSuccess: (res) => {
      if (res?.row) applyRowToCache(qc, runId, res.row);
    },
  });
}

export interface IssueActionBody {
  run_id: string;
  item_id: string;
  metric_name: string;
  action: 'add' | 'edit' | 'delete' | 'approve';
  issue?: Record<string, unknown>;
  issue_id?: string;
  issue_index?: number;
  expected_issue?: Record<string, unknown>;
  client_issue_id?: string;
  pass_number?: number;
  expected_pass_version?: number;
}

export function useIssueAction(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IssueActionBody) =>
      api.post<RowMutationResult>('/api/runs/update_root_cause_issue', body),
    onSuccess: (res) => {
      if (res?.row) applyRowToCache(qc, runId, res.row);
      void qc.invalidateQueries({ queryKey: runKeys.reviewHistory(runId) });
    },
  });
}

export function useAggregateAnalysis(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { metric?: string }) =>
      api.post<Record<string, unknown>>(runUrl(runId, '/aggregate-analysis'), body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: runKeys.compact(runId) }),
  });
}

export function useApproveLegacyCorrection(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { correctionId: string; comment?: string }) =>
      api.post<Record<string, unknown>>(`/api/corrections/${encodeURIComponent(args.correctionId)}/approve`, {
        comment: args.comment ?? '',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: runKeys.compact(runId) }),
  });
}

export function exportHtmlUrl(runId: string): string {
  return runUrl(runId, '/export-html');
}
