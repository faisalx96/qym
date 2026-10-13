import type { AnalysisScope } from '@/api/analysis';
import { Navigate, useLocation } from 'react-router-dom';
import { useAnalysisConfig, useRunSummary, type AnalysisJob } from '@/api/analysis';
import { projectPath } from '@/app/routes';
import { ErrorState, LinkButton, useToast } from '@/ui';
import { fullWidth } from '@/features/shell/layout';
import { AnalyzerFrame } from './AnalyzerFrame';
import { CompactJobRail } from './blocks/ActionRail';
import { outcomeText, summarize } from './blocks/JobStatus';
import { GuidanceArea } from './GuidanceArea';
import { RunAnalyze } from './RunAnalyze';
import { useAnalysisPhase } from './useAnalysisPhase';
import { useAnalysisRunner } from './useAnalysisRunner';
import type { useAnalyzerRoute } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/** Run scope: the page frame (one tab row), the run workspace (kept mounted) and the guidance tabs. */
export function RunShell({
  slug,
  runId,
  canManage,
  scope,
  route,
}: {
  slug: string;
  runId: string;
  canManage: boolean;
  scope: AnalysisScope;
  route: ReturnType<typeof useAnalyzerRoute>;
}) {
  const toast = useToast();
  const config = useAnalysisConfig(scope);
  const summary = useRunSummary(runId);
  const location = useLocation();

  // Success is announced by the action rail and the Results section; a toast is only for trouble.
  const runner = useAnalysisRunner(runId, route.pass, (job: AnalysisJob) => {
    const sum = summarize(job);
    if (job.status === 'completed') {
      if (sum.allFailed) toast.show(`Analysis failed: ${outcomeText(sum)}`, { tone: 'error' });
      else if (sum.failed)
        toast.show(`Analysis finished with errors: ${outcomeText(sum)}`, { tone: 'warning' });
    } else if (job.status === 'cancelled')
      toast.show('Analysis cancelled. Items already analyzed were kept.', { tone: 'info' });
    else toast.show(job.error || 'The analysis failed', { tone: 'error' });
  });
  const phase = useAnalysisPhase(runner, false);

  // A run opened under another project's slug lands under its own project (as run detail does).
  const ownSlug = summary.data?.run?.project?.slug;
  if (ownSlug && ownSlug !== slug)
    return <Navigate to={`${projectPath(ownSlug, 'analysis')}${location.search}`} replace />;
  // The run itself failed to load (unknown id): say so before the run-scoped config error.
  if ((summary.isError || config.isError) && !summary.data?.run) {
    return (
      <div className={`${fullWidth} ${s.page}`}>
        <ErrorState
          error={summary.error ?? config.error}
          title="Unable to load auto-analysis"
          notFoundMessage="Run not found. It may have been deleted, or the link is wrong."
          onRetry={() => {
            void summary.refetch();
            void config.refetch();
          }}
          action={<LinkButton to={projectPath(slug)}>Open Runs</LinkButton>}
        />
      </div>
    );
  }

  const onRun = route.scope === 'run';
  const run = summary.data?.run;
  return (
    <AnalyzerFrame
      slug={slug}
      scope={scope}
      tab={route.scope}
      onTab={route.setScope}
      description="Diagnose the failed metric targets of one run."
      meta={run ? [run.run_name || run.run_id] : undefined}
      live={phase.live}
    >
      <div hidden={!onRun}>
        {config.isError && !config.data ? (
          <ErrorState
            error={config.error}
            title="Couldn’t load the analyzer configuration"
            onRetry={() => config.refetch()}
          />
        ) : config.data ? (
          <RunAnalyze slug={slug} runId={runId} config={config.data} route={route} runner={runner} />
        ) : null}
      </div>
      {route.scope !== 'run' ? (
        <>
          <GuidanceArea scope={scope} slug={slug} canManage={canManage} tab={route.scope} />
          <CompactJobRail
            runner={runner}
            phase={phase}
            slug={slug}
            runId={runId}
            onOpen={() => route.setScope('run')}
          />
        </>
      ) : null}
    </AnalyzerFrame>
  );
}
