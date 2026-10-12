/**
 * Run detail API hooks (brief 04 §4). Cookie auth through `api`; every
 * fetcher throws ApiError on failure. `GET /api/runs/{id}` answers 200
 * `{error}` for not-found/denied: the fetcher classifies that envelope into a
 * 404/403 ApiError so ErrorState works unchanged (OPEN_QUESTIONS 2026-10-11).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import type {
  CategoryCatalog,
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
  compact: (runId: string) => ['run', runId, 'compact'] as const,
  live: (runId: string) => ['run', runId, 'live-status'] as const,
  passes: (runId: string) => ['run', runId, 'passes'] as const,
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

export function useRunQuery(runId: string, opts: { refetchInterval?: number | false } = {}) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: runKeys.compact(runId),
    queryFn: async () =>
      reuseRows(qc.getQueryData<RunPayload>(runKeys.compact(runId)), await fetchRunCompact(runId)),
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    structuralSharing: false,
    refetchInterval: opts.refetchInterval ?? false,
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
