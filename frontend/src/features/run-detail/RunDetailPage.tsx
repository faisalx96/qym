/** /projects/:slug/runs/* — the run page (brief 04). Loads the run, owns live updates and the error states. */
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { projectPath, runPath } from '@/app/routes';
import { classifyError } from '@/lib/http';
import { NotFound } from '@/features/shell/NotFound';
import { useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { useRunQuery, useRunSummaryQuery } from '@/api/runs';
import { useDelayedPending } from '@/lib/pending';
import { ErrorState, LinkButton, Skeleton } from '@/ui';
import { RunBody } from './RunBody';

// The Overview is the first thing the rows paint: its chunk starts with this page, in step with the rows request.
void import('./components/panels/OverviewTab');

/** Name the failure: a missing run, no access, an ended session or a server problem each say so. */
const RUN_ERROR_TITLES: Record<string, string> = {
  not_found: 'Run not found',
  forbidden: 'No access to this run',
  auth: 'Signed out',
  server: 'Server error',
  network: 'Network error',
};

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
  const { slug, project } = useProjectContext();
  const location = useLocation();
  // Staged loading (perf round 6): the header paints from the runs list cache (stage 0) and the summary (stage 1)
  // while the rows (stage 2) are on their way in parallel; the late row groups load when their section nears.
  const summary = useRunSummaryQuery(runId, slug, {
    id: project.id,
    slug: project.slug,
    name: project.name,
  });
  const rows = useRunQuery(runId);
  const payload = rows.data ?? summary.data;
  const failed = !payload && (rows.isError || summary.isError);
  const error = rows.error ?? summary.error;
  const showSkeleton = useDelayedPending(!payload && !failed);
  if (!payload && !failed) return showSkeleton ? <RunSkeleton /> : null;
  if (failed || !payload) {
    const kind = classifyError(error).kind;
    return (
      <div className={fullWidth}>
        <ErrorState
          error={error}
          title={RUN_ERROR_TITLES[kind] ?? 'Couldn’t load this run'}
          notFoundMessage="Run not found. It may have been deleted, or the link is wrong."
          onRetry={() => {
            void summary.refetch();
            void rows.refetch();
          }}
          action={
            <LinkButton to={projectPath(slug)} variant="neutral">
              ← Back to runs
            </LinkButton>
          }
        />
      </div>
    );
  }
  // A link carrying the wrong project (old bookmark, hand-edited URL) lands under the run's own project.
  const ownSlug = payload.run.project?.slug;
  if (ownSlug && ownSlug !== slug) {
    return <Navigate to={runPath(ownSlug, runId) + location.search + location.hash} replace />;
  }
  // A summary that is only the list row (stage 0) has no review count or neighbours yet.
  const summaryData = summary.isPlaceholderData ? undefined : summary.data;
  return <RunBody runId={runId} payload={payload} rowsPending={!rows.data} summary={summaryData} />;
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
