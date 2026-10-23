/** Eval queue API (brief 06 §4, api/eval_queue.py): live jobs, remote snapshots, cancels. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import type { EvalPriority } from './evalCommon';

export type QueueStatus = 'QUEUED' | 'SUBMITTING' | 'SUBMITTED' | 'RUNNING' | 'BLOCKED' | 'CANCELLING';
export const QUEUE_STATUSES: QueueStatus[] = [
  'QUEUED',
  'SUBMITTING',
  'SUBMITTED',
  'RUNNING',
  'BLOCKED',
  'CANCELLING',
];
/** Jobs that never reached the service: cancelling removes them locally. */
export const QUEUED_HERE: QueueStatus[] = ['QUEUED', 'BLOCKED'];

export interface QueueRun {
  id: string;
  status: string;
  status_reason: string | null;
  started_at: string | null;
  last_event_at: string | null;
  items_done: number | null;
  items_total: number | null;
  deleted: boolean;
}

export interface QueueJob {
  id: string;
  experiment_id: string;
  experiment_name: string;
  environment_id: string;
  environment_name: string;
  combo_index: number;
  /** Position of a fanned-out job's dataset pair (0 for any other job). */
  dataset_index?: number;
  attempt: number;
  run_name: string | null;
  params: Record<string, unknown>;
  priority: EvalPriority;
  /** The experiment is latency-sensitive (makes other jobs on its environment wait). */
  latency_sensitive: boolean;
  status: QueueStatus;
  wait_reason: string | null;
  /** Admission state copied from the service (latency-sensitive jobs). */
  admitted_at: string | null;
  deferrals: number;
  deferral_reason: string | null;
  contaminated_attempts: number;
  error: string | null;
  queue_position: number | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_at: string;
  next_attempt_at: string | null;
  submitted_at: string | null;
  cancel_requested_at: string | null;
  remote_job_id: string | null;
  remote_status: string | null;
  can_cancel: boolean;
  run: QueueRun | null;
}

export interface QueueEnvironment {
  id: string;
  name: string;
  is_active: boolean;
  health_status: string | null;
  health_error: string | null;
  inflight: number;
  queued: number;
  blocked: number;
  stale_remote: number;
  counts: Record<string, number>;
  high_active: boolean;
  /** A latency-sensitive job of ours is active on this environment. */
  latency_active: boolean;
}

export interface QueueResponse {
  jobs: QueueJob[];
  total: number;
  limit: number;
  environments: QueueEnvironment[];
}

export interface QueueFilters {
  environment?: string;
  statuses?: string[];
  mine?: boolean;
  experiment?: string;
  /** Only jobs of latency-sensitive experiments. */
  latency?: boolean;
}

export function queueQueryString(filters: QueueFilters, limit = 500): string {
  const q = new URLSearchParams();
  if (filters.environment) q.set('environment_id', filters.environment);
  (filters.statuses ?? []).forEach((s) => q.append('status', s));
  if (filters.mine) q.set('mine', 'true');
  if (filters.experiment) q.set('experiment_id', filters.experiment);
  if (filters.latency) q.set('latency_sensitive', 'true');
  q.set('limit', String(limit));
  return q.toString();
}

export const queueKey = (projectId: string, filters: QueueFilters) =>
  ['eval-queue', projectId, filters] as const;

export function fetchQueue(projectId: string, filters: QueueFilters, limit = 500): Promise<QueueResponse> {
  return api.get<QueueResponse>(`/v1/projects/${projectId}/eval-queue?${queueQueryString(filters, limit)}`);
}

export function useQueue(
  projectId: string | undefined,
  filters: QueueFilters,
  refetchInterval: number | false,
) {
  return useQuery({
    queryKey: queueKey(projectId ?? '', filters),
    enabled: Boolean(projectId),
    queryFn: () => fetchQueue(projectId ?? '', filters),
    refetchInterval,
    placeholderData: keepPreviousData,
  });
}

export interface RemoteItem {
  remote_job_id: string;
  status: string;
  priority: string | null;
  user_id: string | null;
  created_at: string | null;
  run_name: string | null;
  orphan: boolean;
  stale: boolean;
  match: null | { job_id: string; experiment_id: string; experiment_name: string; status: string };
}

export interface RemoteEnvironment {
  environment_id: string;
  environment_name: string;
  is_active: boolean;
  health_status: string | null;
  fetched_at: string | null;
  fetch_error: string | null;
  stale: boolean;
  orphan_count: number;
  stale_count: number;
  items: RemoteItem[];
}

export interface RemoteQueueResponse {
  environments: RemoteEnvironment[];
  can_cancel_orphans: boolean;
}

/** Loaded only while the Remote queue section is open (`enabled`). */
export function useRemoteQueue(
  projectId: string | undefined,
  environmentId: string | undefined,
  enabled: boolean,
  refetchInterval: number | false,
) {
  return useQuery({
    queryKey: ['eval-queue-remote', projectId ?? '', environmentId ?? null] as const,
    enabled: enabled && Boolean(projectId),
    queryFn: () =>
      api.get<RemoteQueueResponse>(
        `/v1/projects/${projectId}/eval-queue/remote${environmentId ? `?environment_id=${encodeURIComponent(environmentId)}` : ''}`,
      ),
    refetchInterval,
  });
}

export type CancelOutcome = 'cancelled' | 'cancelling' | 'forbidden' | 'already_terminal' | 'not_found';

export interface CancelResult {
  outcomes: Record<string, string>;
  counts: Record<string, number>;
}

export type QueueCancelBody =
  { job_ids: string[]; reason?: string } | { experiment_id: string; statuses?: string[]; reason?: string };

export function useCancelQueueJobs(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QueueCancelBody) =>
      api.post<CancelResult>(`/v1/projects/${projectId}/eval-queue/cancel`, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['eval-queue', projectId] });
      void qc.invalidateQueries({ queryKey: ['eval-queue-remote', projectId] });
      void qc.invalidateQueries({ queryKey: ['experiments', projectId] });
      void qc.invalidateQueries({ queryKey: ['experiment', projectId] });
    },
  });
}

export interface RemoteCancelResult {
  environment_id: string;
  outcomes: Record<string, string>;
  errors: Record<string, string>;
  counts: Record<string, number>;
}

export function useCancelRemoteJobs(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { environment_id: string; remote_job_ids: string[]; reason?: string }) =>
      api.post<RemoteCancelResult>(`/v1/projects/${projectId}/eval-queue/remote/cancel`, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['eval-queue-remote', projectId] });
      void qc.invalidateQueries({ queryKey: ['eval-queue', projectId] });
    },
  });
}
