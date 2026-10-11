/**
 * TanStack Query hooks for POST /api/dashboard/* and the run workflow routes
 * (brief 03 §4, §8 "Server cache keys").
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/http';
import type {
  CorrectionsResponse,
  DashboardFilters,
  GroupMetrics,
  KpisResponse,
  ModelsStatsResponse,
  Overview,
  RunPasses,
  RunRow,
  RunsPage,
  RunStatus,
  Trend,
} from './dashboardTypes';
import type { Member } from './types';

export const dashboardKeys = {
  all: (slug: string) => ['dashboard', slug] as const,
  runs: (slug: string, body: RunsBody) => ['dashboard', slug, 'runs', body] as const,
  overview: (slug: string, filters: DashboardFilters, sort?: string, collation?: string[] | null) =>
    ['dashboard', slug, 'overview', filters, sort ?? null, collation ?? null] as const,
  kpis: (slug: string, filters: DashboardFilters) => ['dashboard', slug, 'kpis', filters] as const,
  points: (slug: string, filters: DashboardFilters, sort: string, task: string, dataset: string) =>
    ['dashboard', slug, 'points', filters, sort, task, dataset] as const,
  trend: (slug: string, days: number, task: string | null, dataset: string | null, tz: number) =>
    ['dashboard', slug, 'trend', days, task, dataset, tz] as const,
  modelsStats: (body: ModelsStatsBody) => ['dashboard', 'models-stats', body] as const,
  corrections: (slug: string) => ['corrections', 'pending', slug] as const,
};
export const runKeys = {
  passes: (id: string) => ['run', id, 'passes'] as const,
  groupMetrics: (id: string, metric: string, threshold: number) =>
    ['run', id, 'group-metrics', metric, threshold] as const,
};

export interface RunsBody {
  project_slug: string;
  filters: DashboardFilters;
  sort?: string;
  limit?: number;
  offset?: number;
  ids?: string[];
  include_overview?: boolean;
  collation?: string[] | null;
}

export function fetchRunsPage(body: RunsBody, signal?: AbortSignal): Promise<RunsPage> {
  const { collation, ...rest } = body;
  return api.post<RunsPage>('/api/dashboard/runs', collation ? { ...rest, collation } : rest, { signal });
}

export interface UseRunsPageOptions {
  enabled?: boolean;
  refetchInterval?: number | false | (() => number | false);
  keepPrevious?: boolean;
}

export function useRunsPage(body: RunsBody, opts: UseRunsPageOptions = {}) {
  return useQuery({
    queryKey: dashboardKeys.runs(body.project_slug, body),
    queryFn: ({ signal }) => fetchRunsPage(body, signal),
    enabled: opts.enabled ?? true,
    placeholderData: opts.keepPrevious === false ? undefined : keepPreviousData,
    refetchInterval: opts.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function fetchOverview(
  slug: string,
  filters: DashboardFilters,
  sort?: string,
  collation?: string[] | null,
  signal?: AbortSignal,
): Promise<Overview> {
  const body: Record<string, unknown> = { project_slug: slug, filters };
  if (sort) body.sort = sort;
  if (collation) body.collation = collation;
  return api.post<Overview>('/api/dashboard/overview', body, { signal });
}

export function useOverview(
  slug: string,
  filters: DashboardFilters,
  opts: { sort?: string; collation?: string[] | null; enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: dashboardKeys.overview(slug, filters, opts.sort, opts.collation),
    queryFn: ({ signal }) => fetchOverview(slug, filters, opts.sort, opts.collation, signal),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: opts.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useKpis(slug: string, filters: DashboardFilters, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: dashboardKeys.kpis(slug, filters),
    queryFn: ({ signal }) =>
      api.post<KpisResponse>('/api/dashboard/kpis', { project_slug: slug, filters }, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export const POINTS_PAGE = 500;

/** Full run history of one task+dataset card, 500 rows a page until has_more is false. */
export function usePoints(
  slug: string,
  filters: DashboardFilters,
  sort: string,
  task: string,
  dataset: string,
  opts: { enabled?: boolean; collation?: string[] | null } = {},
) {
  return useInfiniteQuery({
    queryKey: dashboardKeys.points(slug, filters, sort, task, dataset),
    queryFn: ({ pageParam, signal }) =>
      api.post<RunsPage>(
        '/api/dashboard/points',
        {
          project_slug: slug,
          filters,
          task,
          dataset,
          limit: POINTS_PAGE,
          offset: pageParam,
          sort,
          ...(opts.collation ? { collation: opts.collation } : {}),
        },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useTrend(
  slug: string,
  days: 7 | 30 | 90,
  task: string | null,
  dataset: string | null,
  opts: { refetchInterval?: number | false } = {},
) {
  const tz = new Date().getTimezoneOffset() * -1;
  return useQuery({
    queryKey: dashboardKeys.trend(slug, days, task, dataset, tz),
    queryFn: ({ signal }) =>
      api.post<Trend>(
        '/api/dashboard/trend',
        { project_slug: slug, days, task, dataset, tz_offset_minutes: tz },
        { signal },
      ),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export interface ModelsStatsBody {
  metric: string;
  threshold: number;
  is_boolean: boolean;
  direction: 'maximize' | 'minimize' | null;
  groups: { key: string; runs: string[] }[];
}

export function useModelsStats(body: ModelsStatsBody | null) {
  return useQuery({
    queryKey: dashboardKeys.modelsStats(body ?? { metric: '', threshold: 0, is_boolean: false, direction: null, groups: [] }),
    queryFn: ({ signal }) => api.post<ModelsStatsResponse>('/api/dashboard/models/stats', body, { signal }),
    enabled: Boolean(body && body.groups.length),
    staleTime: 60_000,
  });
}

export function usePendingCorrections(slug: string, limit = 12) {
  return useQuery({
    queryKey: dashboardKeys.corrections(slug),
    queryFn: ({ signal }) =>
      api.get<CorrectionsResponse>(
        `/api/corrections?limit=${limit}&status=pending&project_slug=${encodeURIComponent(slug)}`,
        { signal },
      ),
    staleTime: 30_000,
  });
}

/** `{error}` with HTTP 200 on the legacy run routes → thrown Error. */
function unwrapLegacy<T extends { error?: string }>(data: T): T {
  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) throw new Error(data.error);
  return data;
}

export function useRunPasses(runId: string, opts: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: runKeys.passes(runId),
    queryFn: async ({ signal }) =>
      unwrapLegacy(await api.get<RunPasses>(`/api/runs/${encodeRunId(runId)}/passes`, { signal })),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval ?? false,
    refetchIntervalInBackground: false,
  });
}

export function useGroupMetrics(
  runId: string,
  metric: string | null,
  threshold: number,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: runKeys.groupMetrics(runId, metric ?? '', threshold),
    queryFn: async ({ signal }) =>
      unwrapLegacy(
        await api.get<GroupMetrics>(
          `/api/runs/${encodeRunId(runId)}/group-metrics?metric=${encodeURIComponent(metric ?? '')}&threshold=${threshold}`,
          { signal },
        ),
      ),
    enabled: (opts.enabled ?? true) && Boolean(metric),
    placeholderData: keepPreviousData,
  });
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId, 'members'],
    queryFn: () => api.get<{ members: Member[] }>(`/v1/projects/${projectId}/members`),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}

export function encodeRunId(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/** Patch a run's status in every cached runs page (today's applyRunWorkflowResult). */
export function patchRunStatus(qc: QueryClient, slug: string, runId: string, patch: Partial<RunRow>) {
  qc.setQueriesData<RunsPage>({ queryKey: [...dashboardKeys.all(slug), 'runs'] }, (page) => {
    if (!page) return page;
    const map = (r: RunRow) => (r.run_id === runId ? { ...r, ...patch } : r);
    return { ...page, rows: page.rows.map(map), pinned_rows: (page.pinned_rows ?? []).map(map) };
  });
}

export function invalidateDashboard(qc: QueryClient, slug: string) {
  void qc.invalidateQueries({ queryKey: dashboardKeys.all(slug) });
}

type WorkflowAction = 'approve' | 'reject' | 'unapprove' | 'unreject' | 'submit';

export function useRunWorkflow(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, action, comment }: { runId: string; action: WorkflowAction; comment?: string }) =>
      api.post<{ ok: boolean; status: RunStatus }>(`/v1/runs/${encodeRunId(runId)}/${action}`, {
        comment: comment ?? '',
      }),
    onSuccess: (result, { runId }) => {
      patchRunStatus(qc, slug, runId, { status: result.status });
      invalidateDashboard(qc, slug);
    },
  });
}

export function useSubmitRuns(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runIds, comment }: { runIds: string[]; comment?: string }) =>
      runIds.length === 1
        ? api.post<{ ok: boolean; status: RunStatus }>(`/v1/runs/${encodeRunId(runIds[0]!)}/submit`, {
            comment: comment ?? '',
          })
        : api.post<{ ok: boolean; status?: RunStatus }>('/v1/runs/submit', { run_ids: runIds, comment: comment ?? '' }),
    onSuccess: (_r, { runIds }) => {
      for (const id of runIds) patchRunStatus(qc, slug, id, { status: 'SUBMITTED' });
      invalidateDashboard(qc, slug);
    },
  });
}

export function useTransferOwner(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, userId }: { runId: string; userId: string }) =>
      api.post<{ owner: { id?: string; display_name: string; email: string } }>(
        `/v1/runs/${encodeRunId(runId)}/owner`,
        { user_id: userId },
      ),
    onSuccess: (result, { runId, userId }) => {
      patchRunStatus(qc, slug, runId, {
        owner: { id: result.owner.id ?? userId, display_name: result.owner.display_name, email: result.owner.email },
      });
      invalidateDashboard(qc, slug);
    },
  });
}

export function useDeleteRuns(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runIds }: { runIds: string[] }) => {
      const failures: { runId: string; error: unknown }[] = [];
      let purgeAfterDays: number | undefined;
      for (const runId of runIds) {
        try {
          const r = await api.post<{ ok: boolean; purge_after_days?: number }>('/api/runs/delete', { file_path: runId });
          purgeAfterDays = r.purge_after_days ?? purgeAfterDays;
        } catch (error) {
          failures.push({ runId, error });
        }
      }
      return { deleted: runIds.length - failures.length, failures, purgeAfterDays };
    },
    onSettled: () => invalidateDashboard(qc, slug),
  });
}

export function useDeletePasses(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, passes }: { runId: string; passes: number[] | 'all' }) => {
      if (passes === 'all') return api.delete(`/api/runs/${encodeRunId(runId)}/passes`);
      for (const n of passes) await api.delete(`/api/runs/${encodeRunId(runId)}/passes/${n}`);
      return null;
    },
    onSettled: (_r, _e, { runId }) => {
      void qc.invalidateQueries({ queryKey: ['run', runId] });
      invalidateDashboard(qc, slug);
    },
  });
}
