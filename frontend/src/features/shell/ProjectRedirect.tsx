import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { KEYS, readLocal } from '@/lib/storage';

/**
 * C044: /compare and /reviews open inside a project, so a shared link never sits under the wrong project's shell. With
 * a remembered project the URL moves under it (the query kept); without one the global page stays.
 */
export function ProjectRedirect({ page, children }: { page: 'compare' | 'reviews'; children: ReactNode }) {
  const { search, hash } = useLocation();
  const slug = readLocal(KEYS.lastProjectSlug);
  if (!slug) return <>{children}</>;
  return <Navigate to={`${projectPath(slug, page)}${search}${hash}`} replace />;
}
