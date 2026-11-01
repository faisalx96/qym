import { createContext, useContext } from 'react';
import type { Project } from '@/api/types';

export interface ProjectValue {
  project: Project;
  slug: string;
  /** Archived project, or the caller is a Viewer (C033): every mutation control is hidden. */
  readOnly: boolean;
  /** The project is archived: the server answers 409 to every change. */
  archived: boolean;
  /** The caller is a Viewer of the project: the server answers 403 to every change (C033). */
  viewer: boolean;
  /** project.role === 'MANAGER' or global admin. */
  canManage: boolean;
  isAdmin: boolean;
}

export const ProjectContext = createContext<ProjectValue | null>(null);

export function useProjectContext(): ProjectValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used under <ProjectLayout>');
  return ctx;
}

/** Why the project's controls are locked, for a tooltip or a toast. */
export function readOnlyReason(ctx: Pick<ProjectValue, 'archived' | 'viewer'>): string {
  return ctx.archived ? 'This project is archived.' : 'Viewers cannot change this project.';
}

/** Nullable variant for shell chrome rendered outside a project route. */
export function useOptionalProject(): ProjectValue | null {
  return useContext(ProjectContext);
}
