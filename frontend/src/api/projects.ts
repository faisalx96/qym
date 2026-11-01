import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/http';
import { adminKeys } from './admin';
import { meKey } from './me';
import type { ArchivePreview, DeletionPreview, Me, Project, UnarchivePreview } from './types';

export const projectKey = (slug: string) => ['project', slug] as const;

export function fetchProjectBySlug(slug: string): Promise<Project> {
  return api.get<Project>(`/v1/projects/by-slug/${encodeURIComponent(slug)}`);
}

/**
 * Project by slug: seeded from me.projects; falls back to the by-slug route so
 * archived projects (absent from /v1/me) resolve as read-only. 403 = no access,
 * 404 = not found (callers inspect ApiError.status).
 */
export function useProject(slug: string | undefined, me: Me | undefined) {
  const qc = useQueryClient();
  const seeded = me?.projects.find((p) => p.slug === slug);
  return useQuery({
    queryKey: projectKey(slug ?? ''),
    queryFn: () => fetchProjectBySlug(slug ?? ''),
    enabled: Boolean(slug),
    initialData: seeded,
    initialDataUpdatedAt: seeded ? qc.getQueryState(meKey)?.dataUpdatedAt : undefined,
    staleTime: 30_000,
    retry: false,
  });
}

/** Keep breadcrumb/switcher in sync after a rename/create (shell.js upsertProject). */
export function upsertProjectInCache(qc: ReturnType<typeof useQueryClient>, project: Project) {
  qc.setQueryData<Me>(meKey, (me) => {
    if (!me) return me;
    const exists = me.projects.some((p) => p.id === project.id);
    const projects = exists
      ? me.projects.map((p) => (p.id === project.id ? { ...p, ...project } : p))
      : [...me.projects, project];
    projects.sort((a, b) => a.name.localeCompare(b.name));
    return { ...me, projects: project.is_active ? projects : projects.filter((p) => p.id !== project.id) };
  });
  qc.setQueryData(projectKey(project.slug), project);
}

export function removeProjectFromCache(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.setQueryData<Me>(meKey, (me) =>
    me ? { ...me, projects: me.projects.filter((p) => p.id !== projectId) } : me,
  );
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug?: string }) => api.post<Project>('/v1/projects', body),
    onSuccess: (project) => {
      upsertProjectInCache(qc, project);
      void qc.invalidateQueries({ queryKey: meKey });
      void qc.invalidateQueries({ queryKey: adminKeys.projects });
    },
  });
}

export function useRenameProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; slug?: string }) =>
      api.patch<Project>(`/v1/admin/projects/${projectId}`, body),
    onSuccess: (project) => {
      upsertProjectInCache(qc, project);
      void qc.invalidateQueries({ queryKey: adminKeys.projects });
    },
  });
}

/**
 * Save the correction review rules. The saved rules go into the cached project at once, so the
 * settings form compares against them: setting a rule back after a save enables Save rules (C010).
 */
export function useReviewRules(project: Pick<Project, 'id' | 'slug'>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      correction_approvers: 'members' | 'managers';
      correction_require_different_reviewer: boolean;
    }) =>
      api.patch<{
        project_id: string;
        correction_approvers: 'members' | 'managers';
        correction_require_different_reviewer: boolean;
      }>(`/v1/projects/${project.id}/review-rules`, body),
    onSuccess: (res) => {
      const rules = {
        correction_approvers: res.correction_approvers,
        correction_require_different_reviewer: res.correction_require_different_reviewer,
      };
      qc.setQueryData<Project>(projectKey(project.slug), (p) => (p ? { ...p, ...rules } : p));
      qc.setQueryData<Me>(meKey, (me) =>
        me ? { ...me, projects: me.projects.map((p) => (p.id === project.id ? { ...p, ...rules } : p)) } : me,
      );
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

/** Save which way is better for a metric that declares no direction, for the whole project (C129). */
export function useSetMetricDirection(project: Project) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { metric: string; direction: 'maximize' | 'minimize' | null }) =>
      api.patch<{ project_id: string; metric_directions: Record<string, 'maximize' | 'minimize'> }>(
        `/v1/projects/${project.id}/metric-directions`,
        body,
      ),
    onSuccess: (res) => {
      const next = { ...project, metric_directions: res.metric_directions };
      qc.setQueryData<Project>(projectKey(project.slug), (p) =>
        p ? { ...p, metric_directions: res.metric_directions } : p,
      );
      upsertProjectInCache(qc, next);
    },
  });
}

export const fetchArchivePreview = (id: string) =>
  api.get<ArchivePreview>(`/v1/admin/projects/${id}/archive-preview`);
export const fetchUnarchivePreview = (id: string) =>
  api.get<UnarchivePreview>(`/v1/admin/projects/${id}/unarchive-preview`);
export const fetchDeletionPreview = (id: string) =>
  api.get<DeletionPreview>(`/v1/admin/projects/${id}/deletion`);

/** What a delete would remove and whether it is blocked, for the Danger zone row (admins only, C118). */
export function useDeletionPreview(projectId: string) {
  return useQuery({
    queryKey: ['project-deletion', projectId] as const,
    queryFn: () => fetchDeletionPreview(projectId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: Project) => api.post<{ ok: boolean }>(`/v1/admin/projects/${project.id}/archive`),
    onSuccess: (_r, project) => {
      removeProjectFromCache(qc, project.id);
      qc.setQueryData(projectKey(project.slug), { ...project, is_active: false });
      void qc.invalidateQueries({ queryKey: meKey });
      void qc.invalidateQueries({ queryKey: adminKeys.projects });
    },
  });
}

export function useUnarchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: Project) => api.post<Project>(`/v1/admin/projects/${project.id}/unarchive`),
    onSuccess: (updated) => {
      upsertProjectInCache(qc, updated);
      void qc.invalidateQueries({ queryKey: meKey });
      void qc.invalidateQueries({ queryKey: adminKeys.projects });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ project, confirm }: { project: Project; confirm: string }) =>
      api.delete<{ ok: boolean }>(`/v1/admin/projects/${project.id}?confirm=${encodeURIComponent(confirm)}`),
    onSuccess: (_r, { project }) => {
      removeProjectFromCache(qc, project.id);
      qc.removeQueries({ queryKey: projectKey(project.slug) });
      void qc.invalidateQueries({ queryKey: meKey });
      void qc.invalidateQueries({ queryKey: adminKeys.projects });
    },
  });
}

export function isNoAccess(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
