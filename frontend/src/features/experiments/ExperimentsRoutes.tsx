/**
 * Route glue for /projects/:slug/experiments (brief 06 §8): the list, `new`, a detail
 * page by id, and the legacy query forms (`?experiment=`, `?new=1`, `?view=environments`,
 * `?environment=`) redirected to their path routes so old emails and links keep working.
 */
import { lazy, Suspense } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useProjectContext } from '@/features/shell';
import { Skeleton } from '@/ui';
import { loadExperimentDetailPage, loadLaunchPage } from './lazy';
import { environmentPath, environmentsPath, experimentPath, launchPath } from './paths';
import { ExperimentsPage } from './list/ExperimentsPage';

// C081: the launch form (115 KB gzip) and the detail page load only when opened.
const LaunchPage = lazy(() => loadLaunchPage().then((m) => ({ default: m.LaunchPage })));
const ExperimentDetailPage = lazy(() =>
  loadExperimentDetailPage().then((m) => ({ default: m.ExperimentDetailPage })),
);
const loading = <Skeleton kind="lines" rows={6} label="Loading page" />;

export function ExperimentsIndexRoute() {
  const { slug } = useProjectContext();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const rest = (drop: string[]) => {
    const next = new URLSearchParams(params);
    drop.forEach((k) => next.delete(k));
    return Object.fromEntries(next.entries());
  };
  if (params.get('environment'))
    return <Navigate replace to={environmentPath(slug, params.get('environment') ?? '')} />;
  if (params.get('view') === 'environments') return <Navigate replace to={environmentsPath(slug)} />;
  if (params.get('experiment'))
    return <Navigate replace to={experimentPath(slug, params.get('experiment') ?? '')} />;
  if (params.get('new')) return <Navigate replace to={launchPath(slug, rest(['new']))} />;
  return <ExperimentsPage />;
}

export function ExperimentsSplatRoute() {
  const segment = (useParams()['*'] ?? '').split('/')[0];
  if (segment === 'new')
    return (
      <Suspense fallback={loading}>
        <LaunchPage />
      </Suspense>
    );
  if (!segment) return <ExperimentsPage />;
  return (
    <Suspense fallback={loading}>
      <ExperimentDetailPage experimentId={decodeURIComponent(segment)} />
    </Suspense>
  );
}
