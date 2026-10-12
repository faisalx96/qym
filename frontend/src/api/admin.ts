/** Admin area hooks (brief 09 §4): users, cross-project runs, maintenance. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { usePollingInterval } from '@/lib/polling';
import { announceRunStatus } from '@/lib/run-status';
import { meKey } from './me';
import type { Project } from './types';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  title?: string | null;
  role: 'ADMIN' | 'MEMBER';
  is_active: boolean;
}

export interface AdminRunSummary {
  run_id: string;
  run_name: string;
  external_run_id?: string | null;
  task_name?: string | null;
  dataset_name?: string | null;
  model_name?: string | null;
  status: string;
  status_reason?: string | null;
  stop_requested?: boolean;
  can_force_stop: boolean;
  ended_at?: string | null;
  timestamp?: string | null;
  started_at?: string | null;
  last_event_at?: string | null;
  progress_completed?: number | null;
  progress_total?: number | null;
  progress_pct?: number | null;
  total_items?: number | null;
  error_count?: number | null;
  owner?: { id: string; email?: string | null; display_name?: string | null } | null;
  project?: { id: string; slug: string; name: string } | null;
}

export interface RunsPage {
  runs: AdminRunSummary[];
  total_count: number;
  last_updated?: string;
}

export interface ForceStopResult {
  ok: boolean;
  run_id: string;
  stopped: boolean;
  status: string;
  status_reason?: string | null;
  ended_at?: string | null;
  can_force_stop: boolean;
}

export type JobStatus =
  'queued' | 'running' | 'paused' | 'cancel_requested' | 'cancelled' | 'succeeded' | 'failed';

export interface MaintenanceJob {
  id: string;
  kind: string;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: Record<string, unknown> & { message?: string };
  log: string;
  error?: string | null;
  requested_by_user_id?: string | null;
  lease_owner?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
}

export interface DbTableStats {
  table: string;
  total_bytes: number;
  heap_bytes: number;
  toast_bytes: number;
  index_bytes: number;
  live_rows: number;
  dead_rows: number;
}

export interface MaintenanceOverview {
  settings: {
    role: string;
    service?: string | null;
    maintenance_mode: boolean;
    event_log_mode: string;
    span_retention_days: number;
    deleted_run_grace_days: number;
    span_partition_days_ahead: number;
  };
  workers: {
    loops: 'local' | 'separate';
    summary_worker_alive: boolean | null;
    maintenance_worker_alive: boolean | null;
    maintenance_current_job?: string | null;
    workers_service?: { alive: boolean; processes: { alive: boolean }[] } | null;
  };
  pool?: string | null;
  db_stats:
    | { error: string }
    | {
        database?: { size_bytes?: number; [k: string]: unknown };
        tables?: DbTableStats[];
        run_events_by_type?: { type: string; rows: number; payload_bytes: number }[];
      };
  db_stats_age_seconds: number;
  job_kinds: Record<string, { irreversible: boolean; description: string }>;
  jobs: MaintenanceJob[];
}

export const adminKeys = {
  users: ['admin', 'users'] as const,
  projects: ['admin', 'projects'] as const,
  live: ['admin', 'runs', 'live'] as const,
  recent: (page: number, size: number) => ['admin', 'runs', 'recent', page, size] as const,
  recentAll: ['admin', 'runs', 'recent'] as const,
  maintenance: ['admin', 'maintenance'] as const,
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = ['queued', 'running', 'cancel_requested'];
export const LIVE_POLL_MS = 10_000;
export const JOB_POLL_MS = 3_000;
export const RECENT_PAGE_SIZE = 6;

// ── Users ────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery({ queryKey: adminKeys.users, queryFn: () => api.get<AdminUser[]>('/v1/admin/users') });
}

export interface CreateUserBody {
  email: string;
  display_name?: string;
  role?: 'ADMIN' | 'MEMBER';
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) =>
      api.post<{ id: string; email: string; existing?: boolean }>('/v1/admin/users', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

export interface UpdateUserBody {
  email?: string;
  display_name?: string;
  role?: 'ADMIN' | 'MEMBER';
  is_active?: boolean;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      api.put<{ id: string; email: string; ok: boolean }>(`/v1/admin/users/${id}`, body),
    onSuccess: (_r, { id, body }) => {
      qc.setQueryData<AdminUser[]>(adminKeys.users, (list) =>
        list?.map((u) => (u.id === id ? { ...u, ...body } : u)),
      );
      void qc.invalidateQueries({ queryKey: adminKeys.users });
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

/** Never cached: the one-time password lives only in the dialog's state. */
export function useResetPassword() {
  return useMutation({
    gcTime: 0,
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; user_id: string; temporary_password: string }>(
        `/v1/admin/users/${id}/reset-password`,
      ),
  });
}

// ── Projects (admins get archived ones too) ──────────────────────────────

export function useAllProjects() {
  return useQuery({
    queryKey: adminKeys.projects,
    queryFn: () => api.get<{ projects: Project[] }>('/v1/projects'),
    select: (d) => d.projects,
  });
}

// ── Runs ─────────────────────────────────────────────────────────────────

export function useLiveRuns(enabled = true) {
  const interval = usePollingInterval(LIVE_POLL_MS);
  return useQuery({
    queryKey: adminKeys.live,
    queryFn: () => api.get<RunsPage>('/api/runs/live?all_projects=true&limit=100'),
    enabled,
    refetchInterval: enabled ? interval : false,
    refetchIntervalInBackground: false,
  });
}

export function useRecentRuns(page: number, pageSize = RECENT_PAGE_SIZE, enabled = true) {
  const offset = Math.max(0, page - 1) * pageSize;
  return useQuery({
    queryKey: adminKeys.recent(page, pageSize),
    queryFn: () =>
      api.get<RunsPage>(
        `/api/runs/recent?all_projects=true&include_projects=false&global_limit=${pageSize}&global_offset=${offset}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * Force stop: cancels in-flight list polls (a poll started before the stop may
 * still return the run as live), drops the run from Live, merges the response
 * into every Recent page, broadcasts STOPPED, then refetches both lists.
 */
export function useForceStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<ForceStopResult>(`/api/runs/${encodeURIComponent(runId)}/force-stop`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: adminKeys.live });
      await qc.cancelQueries({ queryKey: adminKeys.recentAll });
    },
    onSuccess: (result, runId) => {
      qc.setQueryData<RunsPage>(adminKeys.live, (d) => {
        if (!d) return d;
        const had = d.runs.some((r) => r.run_id === runId);
        return {
          ...d,
          runs: d.runs.filter((r) => r.run_id !== runId),
          total_count: had ? Math.max(0, d.total_count - 1) : d.total_count,
        };
      });
      qc.setQueriesData<RunsPage>({ queryKey: adminKeys.recentAll }, (d) =>
        d ? { ...d, runs: d.runs.map((r) => (r.run_id === runId ? { ...r, ...result } : r)) } : d,
      );
      announceRunStatus([runId], 'STOPPED');
      void qc.invalidateQueries({ queryKey: adminKeys.live });
      void qc.invalidateQueries({ queryKey: adminKeys.recentAll });
    },
  });
}

// ── Maintenance ──────────────────────────────────────────────────────────

export function useMaintenance(enabled = true) {
  const interval = usePollingInterval(JOB_POLL_MS);
  return useQuery({
    queryKey: adminKeys.maintenance,
    queryFn: () => api.get<MaintenanceOverview>('/api/admin/maintenance'),
    enabled,
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs ?? [];
      return enabled && interval && jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status))
        ? interval
        : false;
    },
  });
}

export function useRefreshMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<MaintenanceOverview>('/api/admin/maintenance?refresh=1'),
    onSuccess: (data) => qc.setQueryData(adminKeys.maintenance, data),
  });
}

function mergeJob(qc: ReturnType<typeof useQueryClient>, job: MaintenanceJob) {
  qc.setQueryData<MaintenanceOverview>(adminKeys.maintenance, (d) => {
    if (!d) return d;
    const exists = d.jobs.some((j) => j.id === job.id);
    return { ...d, jobs: exists ? d.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...d.jobs] };
  });
}

export function useEnqueueJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: string; params: Record<string, unknown>; confirm?: string }) =>
      api.post<MaintenanceJob>('/api/admin/maintenance/jobs', body),
    onSuccess: (job) => {
      mergeJob(qc, job);
      void qc.invalidateQueries({ queryKey: adminKeys.maintenance });
    },
  });
}

export function useJobAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'cancel' }) =>
      api.post<MaintenanceJob>(`/api/admin/maintenance/jobs/${id}/${action}`),
    onSuccess: (job) => {
      mergeJob(qc, job);
      void qc.invalidateQueries({ queryKey: adminKeys.maintenance });
    },
  });
}
