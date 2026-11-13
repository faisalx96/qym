import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  useAnalysisConfig,
  useRuleVersions,
  useRunSummary,
  type AnalysisJob,
  type AnalysisScope,
  type RuleVersion,
} from '@/api/analysis';
import { projectPath } from '@/app/routes';
import { ErrorState, useToast } from '@/ui';
import { constrained } from '@/features/shell/layout';
import { useMediaQuery } from '@/features/shell/hooks';
import { AnalyzerFrame } from './AnalyzerFrame';
import { CompactJobRail } from './blocks/ActionRail';
import { outcomeText, summarize } from './blocks/JobStatus';
import { GuidanceArea } from './GuidanceArea';
import { RunAnalyze } from './RunAnalyze';
import { useAnalysisPhase } from './useAnalysisPhase';
import { useAnalysisRunner } from './useAnalysisRunner';
import type { useAnalyzerRoute } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/** The viewport width from which the run workspace shows the prompt pane (cv5 K3). */
export const PANE_QUERY = '(min-width: 1500px)';

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
  // cv5 K3: from about 1500 px the prompt preview is a fixed pane next to the settings.
  const pane = useMediaQuery(PANE_QUERY);
  // cv5 Z11: the pane stays on every tab, in one slot that this shell owns, so a tab change never remounts or moves
  // it. The run workspace (kept mounted on every tab) renders the pane into the slot.
  const [paneSlot, setPaneSlot] = useState<HTMLDivElement | null>(null);
  const [openRule, setOpenRule] = useState<RuleVersion | null>(null);
  const rules = useRuleVersions(scope, pane && route.scope === 'rules');
  const paneNote = rulesNote(route.scope === 'rules' ? openRule : null, rules.data?.versions ?? [], rules.data);

  // A run opened under another project's slug lands under its own project (as run detail does).
  const ownSlug = summary.data?.run?.project?.slug;
  if (ownSlug && ownSlug !== slug)
    return <Navigate to={`${projectPath(ownSlug, 'analysis')}${location.search}`} replace />;
  // The run itself failed to load (unknown id): say so before the run-scoped config error.
  if ((summary.isError || config.isError) && !summary.data?.run) {
    return (
      <div className={`${constrained} ${s.page}`}>
        <ErrorState
          error={summary.error ?? config.error}
          title="Couldn’t load auto-analysis"
          notFoundTitle="Run not found"
          notFoundMessage="It may have been deleted, or the link is wrong."
          parent={{ to: projectPath(slug), label: 'Runs' }}
          onRetry={() => {
            void summary.refetch();
            void config.refetch();
          }}
        />
      </div>
    );
  }

  const onRun = route.scope === 'run';
  const run = summary.data?.run;
  return (
    <AnalyzerFrame
      scope={scope}
      tab={route.scope}
      onTab={route.setScope}
      description={
        route.scope === 'run'
          ? 'Diagnose the failed metric targets of one run.'
          : 'Project guidance the analyzer uses for every run: categories, rules and reference documents.'
      }
      meta={run ? [run.run_name || run.run_id] : undefined}
      live={phase.live}
      // The frame stays wide on every tab, so a tab click never moves the header, the tabs or the pane.
      wide={pane}
    >
      <div className={s.shell} data-pane={pane ? '' : undefined}>
        <div className={s.main}>
          <div hidden={!onRun}>
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
                pane={pane}
                paneSlot={pane ? paneSlot : null}
                paneNote={paneNote}
              />
            ) : null}
          </div>
          {route.scope !== 'run' ? (
            // The guidance tabs are the left column, as the settings are on Analyze run (cv5 Z11).
            <div className={s.guidance} data-wide={pane ? '' : undefined}>
              <GuidanceArea
                scope={scope}
                slug={slug}
                canManage={canManage}
                tab={route.scope}
                onRuleVersion={setOpenRule}
              />
              <CompactJobRail
                runner={runner}
                phase={phase}
                slug={slug}
                runId={runId}
                onOpen={() => route.setScope('run')}
              />
            </div>
          ) : null}
        </div>
        {pane ? <div ref={setPaneSlot} className={s.paneSlot} data-testid="prompt-pane-slot" /> : null}
      </div>
    </AnalyzerFrame>
  );
}

/**
 * The pane's honest line on the Rules tab (cv5 Z11): the prompt reads the production rules, so a draft open in the
 * panel does not change it until it is published. No line when the production version has no rules.
 */
export function rulesNote(
  open: RuleVersion | null,
  versions: RuleVersion[],
  data: { production_version_id: string | null } | undefined,
): string | null {
  if (!open || open.status !== 'draft' || !data) return null;
  const production =
    versions.find((v) => v.id === data.production_version_id) ?? versions.find((v) => v.is_active) ?? null;
  if (!production || !production.rule_count) return null;
  return `The prompt uses the production rules (v${production.version}). A draft changes it when you publish.`;
}
