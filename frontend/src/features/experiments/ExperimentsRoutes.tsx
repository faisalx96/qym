/**
 * Route glue for /projects/:slug/experiments (brief 06 §8): the list, `new`, a detail
 * page by id, and the legacy query forms (`?experiment=`, `?new=1`, `?view=environments`,
 * `?environment=`) redirected to their path routes so old emails and links keep working.
 */
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useProjectContext } from '@/features/shell';
import { environmentPath, environmentsPath, experimentPath, launchPath } from './paths';
import { ExperimentsPage } from './list/ExperimentsPage';
import { ExperimentDetailPage } from './detail/ExperimentDetailPage';
import { LaunchPage } from './launch/LaunchPage';

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
  if (segment === 'new') return <LaunchPage />;
  if (!segment) return <ExperimentsPage />;
  return <ExperimentDetailPage experimentId={decodeURIComponent(segment)} />;
}
