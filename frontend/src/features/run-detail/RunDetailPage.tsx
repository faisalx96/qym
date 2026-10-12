/** /projects/:slug/runs/* — the run page (brief 04). Loads the run, owns live updates and the error states. */
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { runPath } from '@/app/routes';
import { NotFound } from '@/features/shell/NotFound';
import { useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { useRunQuery } from '@/api/runs';
import { useDelayedPending } from '@/lib/pending';
import { ErrorState, Skeleton } from '@/ui';
import { RunBody } from './RunBody';

function RunSkeleton() {
  return (
    <div className={fullWidth} aria-busy="true">
      <Skeleton kind="lines" rows={3} label="Loading run data…" />
      <Skeleton kind="cards" count={3} />
      <Skeleton kind="table" rows={8} />
    </div>
  );
}

function RunLoader({ runId }: { runId: string }) {
  const query = useRunQuery(runId);
  const { slug } = useProjectContext();
  const location = useLocation();
  const showSkeleton = useDelayedPending(query.isPending);
  if (query.isPending) return showSkeleton ? <RunSkeleton /> : null;
  if (query.isError || !query.data) {
    return (
      <div className={fullWidth}>
        <ErrorState
          error={query.error}
          title="Couldn’t load this run"
          notFoundMessage="Run not found. It may have been deleted, or the link is wrong."
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  // A link carrying the wrong project (old bookmark, hand-edited URL) lands under the run's own project.
  const ownSlug = query.data.run.project?.slug;
  if (ownSlug && ownSlug !== slug) {
    return <Navigate to={runPath(ownSlug, runId) + location.search + location.hash} replace />;
  }
  return <RunBody runId={runId} payload={query.data} />;
}

export function RunDetailPage() {
  const params = useParams();
  const { slug } = useProjectContext();
  const splat = params['*'] ?? '';
  // `runs/<id>/analyzer` is redirected to the analysis workspace before this page renders (router.tsx).
  const runId = splat.replace(/\/analyzer$/, '');
  if (!runId) return <NotFound />;
  return <RunLoader key={`${slug}/${runId}`} runId={runId} />;
}
