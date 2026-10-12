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

export function useReviewRules(projectId: string) {
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
      }>(`/v1/projects/${projectId}/review-rules`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKey }),
  });
}

export const fetchArchivePreview = (id: string) =>
  api.get<ArchivePreview>(`/v1/admin/projects/${id}/archive-preview`);
export const fetchUnarchivePreview = (id: string) =>
  api.get<UnarchivePreview>(`/v1/admin/projects/${id}/unarchive-preview`);
export const fetchDeletionPreview = (id: string) =>
  api.get<DeletionPreview>(`/v1/admin/projects/${id}/deletion`);

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
