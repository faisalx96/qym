import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { projectPath } from '@/app/routes';

/** `/projects/:slug/analysis?run=ID` with the other query params kept (pass, metric, scope). */
export function analysisUrl(slug: string, runId: string, search = ''): string {
  const params = new URLSearchParams(search);
  params.set('run', runId);
  return `${projectPath(slug, 'analysis')}?${params.toString()}`;
}

/**
 * `/projects/:slug/runs/<id>/analyzer` lands on the workspace. Every other
 * `runs/*` URL renders `children` (the run-detail area's page).
 */
export function RunAnalyzerRedirect({ children }: { children: ReactNode }) {
  const { slug = '', '*': splat = '' } = useParams();
  const location = useLocation();
  const match = /^(.*)\/analyzer\/?$/.exec(splat);
  if (match?.[1]) return <Navigate to={analysisUrl(slug, match[1], location.search)} replace />;
  return <>{children}</>;
}
