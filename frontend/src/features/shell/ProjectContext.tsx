import { createContext, useContext } from 'react';
import type { Project } from '@/api/types';

export interface ProjectValue {
  project: Project;
  slug: string;
  /** Archived project: every mutation control is hidden; server answers 409. */
  readOnly: boolean;
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

/** Nullable variant for shell chrome rendered outside a project route. */
export function useOptionalProject(): ProjectValue | null {
  return useContext(ProjectContext);
}
