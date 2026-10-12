/** Deleted runs (trash) API (brief 07 §4): admin-only list with retention headers, restore. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/http';
import { platformUrl } from '@/lib/runtime';

export interface TrashRun {
  id: string;
  run_name: string;
  task: string | null;
  dataset: string | null;
  dataset_version: string | null;
  dataset_aliases: string[] | null;
  model: string | null;
  trace_stats: Record<string, unknown> | null;
  status: string;
  owner_user_id: string | null;
  deleted_at: string;
  deleted_by_user_id: string | null;
  deleted_by_name: string | null;
  created_at: string;
  purge_at: string | null;
  purge_paused: boolean;
  project_archived: boolean;
  project_id: string;
  project_name: string;
  project_slug: string;
}

export interface TrashPage {
  runs: TrashRun[];
  total: number;
  /** null = retention off */
  graceDays: number | null;
}

export interface TrashProject {
  id: string;
  name: string;
  slug: string;
  archived: boolean;
  deleted_runs: number;
}

export const TRASH_PAGE = 50;

export interface TrashParams {
  q: string;
  projectId: string | null;
  page: number; // 1-based
}

export const trashKeys = {
  list: (p: TrashParams) => ['trash', p] as const,
  projects: ['trash-projects'] as const,
};

async function fetchTrash(p: TrashParams): Promise<TrashPage> {
  const q = new URLSearchParams({ limit: String(TRASH_PAGE), offset: String((p.page - 1) * TRASH_PAGE) });
  if (p.projectId) q.set('project_id', p.projectId);
  if (p.q) q.set('q', p.q);
  const response = await fetch(platformUrl(`/api/runs/trash?${q.toString()}`), {
    credentials: 'same-origin',
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const body = JSON.parse(text) as { detail?: unknown };
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? '');
    } catch {
      detail = text.slice(0, 200);
    }
    throw new ApiError(response.status, detail, { headers: response.headers });
  }
  const runs = (text ? JSON.parse(text) : []) as TrashRun[];
  const total = Number(response.headers.get('X-Qym-Total-Count') ?? runs.length);
  const graceRaw = response.headers.get('X-Qym-Deleted-Run-Grace-Days');
  const grace = graceRaw === null || graceRaw === '' ? null : Number(graceRaw);
  return { runs, total, graceDays: grace !== null && Number.isFinite(grace) && grace > 0 ? grace : null };
}

export function useTrash(params: TrashParams, enabled = true) {
  return useQuery({
    queryKey: trashKeys.list(params),
    queryFn: () => fetchTrash(params),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useTrashProjects(enabled = true) {
  return useQuery({
    queryKey: trashKeys.projects,
    queryFn: () => apiFetch<TrashProject[]>('/api/runs/trash/projects'),
    enabled,
    retry: false,
  });
}

export interface RestoreResult {
  ok: boolean;
  restored?: string[];
  skipped?: { run_id: string; reason: string }[];
}

export const RESTORE_MAX = 200;

export function useRestoreRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runIds: string[]) =>
      runIds.length === 1
        ? apiFetch<RestoreResult>('/api/runs/restore', { method: 'POST', body: { run_id: runIds[0] } })
        : apiFetch<RestoreResult>('/api/runs/restore', { method: 'POST', body: { run_ids: runIds } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trash'] });
      void qc.invalidateQueries({ queryKey: trashKeys.projects });
    },
  });
}
