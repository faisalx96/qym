import type { AnalysisScope } from '@/api/analysis';
import { Navigate, useLocation } from 'react-router-dom';
import { isJobTerminal, useAnalysisConfig, useRunSummary, type AnalysisJob } from '@/api/analysis';
import { projectPath } from '@/app/routes';
import { useSearchParamsState } from '@/lib/url-state';
import { Badge, ErrorState, LinkButton, PageHeader, SegmentedControl, useToast } from '@/ui';
import { fullWidth } from '@/features/shell/layout';
import { GuidanceArea } from './GuidanceArea';
import { JobStatus, outcomeText, summarize } from './blocks/JobStatus';
import { RunAnalyze } from './RunAnalyze';
import { STEP_IDS, type StepId } from './steps';
import { useAnalysisRunner } from './useAnalysisRunner';
import type { useAnalyzerRoute } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/** Run scope: header, area switch, the sticky job bar (visible on every area) and the two areas. */
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
  const { params, pushUrlQuery } = useSearchParamsState();
  const stepParam = params.get('step');
  const step: StepId = (STEP_IDS as string[]).includes(stepParam ?? '') ? (stepParam as StepId) : 'configure';
  // A step is a place in a wizard: Back returns to the previous step instead of leaving the workspace.
  const setStep = (next: StepId) => pushUrlQuery({ step: next === 'configure' ? null : next });

  const runner = useAnalysisRunner(runId, route.pass, (job: AnalysisJob) => {
    const sum = summarize(job);
    if (job.status === 'completed') {
      if (sum.allFailed) toast.show(`Analysis failed: ${outcomeText(sum)}`, { tone: 'error' });
      else toast.show(`Analysis finished: ${outcomeText(sum)}`, { tone: sum.failed ? 'warning' : 'success' });
    } else if (job.status === 'cancelled')
      toast.show('Analysis cancelled. Items already analyzed were kept.', { tone: 'info' });
    else toast.show(job.error || 'The analysis failed', { tone: 'error' });
  });

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

  const area = route.scope === 'run' ? 'run' : 'guidance';
  const job = runner.job;
  const live = Boolean(job && !isJobTerminal(job.status));
  const showBar = Boolean(job) && !(area === 'run' && step === 'review');
  const guidanceTab = route.scope === 'run' ? 'categories' : route.scope;

  return (
    <div className={`${fullWidth} ${s.page}`}>
      <PageHeader
        title="Auto-analysis"
        description="Configure, preview, run and review an analysis; keep project guidance up to date."
        meta={[`Project ${slug}`]}
      />
      <div className={s.areaRow}>
        <SegmentedControl
          label="Workspace area"
          value={area}
          onChange={(v) => route.setScope(v === 'run' ? 'run' : 'categories')}
          options={[
            { value: 'run', label: 'Analyze run' },
            { value: 'guidance', label: 'Project guidance' },
          ]}
        />
        {live && area === 'guidance' ? (
          <Badge tone="info" dot>
            {`Analysis ${job?.progress.completed}/${job?.progress.total}`}
          </Badge>
        ) : null}
      </div>
      {showBar ? (
        <div className={s.stickyBar}>
          <JobStatus
            runner={runner}
            slug={slug}
            runId={runId}
            mode="bar"
            onReview={
              area === 'run'
                ? () => setStep('review')
                : // one URL write: two router updates in a row would drop the first (scope stayed on guidance)
                  () => pushUrlQuery({ scope: null, step: 'review' })
            }
          />
        </div>
      ) : null}

      <div hidden={area !== 'run'}>
        {config.isError && !config.data ? (
          <ErrorState
            error={config.error}
            title="Couldn’t load the analyzer configuration"
            onRetry={() => config.refetch()}
          />
        ) : config.data ? (
          <RunAnalyze
            slug={slug}
            runId={runId}
            config={config.data}
            route={route}
            runner={runner}
            step={step}
            onStep={setStep}
          />
        ) : null}
      </div>
      {area === 'guidance' ? (
        <GuidanceArea
          scope={scope}
          slug={slug}
          canManage={canManage}
          tab={guidanceTab}
          onTab={route.setScope}
        />
      ) : null}
    </div>
  );
}
