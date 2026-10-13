import { useMemo } from 'react';
import { useRunSummary } from '@/api/analysis';
import { useDocumentTitle } from '@/features/shell/hooks';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { AnalyzerFrame } from './AnalyzerFrame';
import { GuidanceArea } from './GuidanceArea';
import { ProjectLanding } from './ProjectLanding';
import { RunShell } from './RunShell';
import { useAnalyzerRoute } from './useAnalyzerRoute';

/** /projects/:slug/analysis[?run=&pass=&metric=&scope=] — the auto-analysis workspace. */
export function AnalyzerPage() {
  const { slug, canManage, readOnly } = useProjectContext();
  const route = useAnalyzerRoute();
  const runName = useRunSummary(route.runId || undefined).data?.run;
  useDocumentTitle(runName ? `Auto-analysis · ${runName.run_name || runName.run_id}` : 'Auto-analysis');
  const manage = canManage && !readOnly;
  const scope = useMemo(() => ({ slug, runId: route.runId || undefined }), [slug, route.runId]);

  if (route.runId)
    return (
      <RunShell
        key={route.runId}
        slug={slug}
        runId={route.runId}
        canManage={manage}
        scope={scope}
        route={route}
      />
    );

  return (
    <AnalyzerFrame
      slug={slug}
      scope={scope}
      tab={route.scope}
      onTab={route.setScope}
      description="Diagnose failed metric targets, and keep the project guidance the analyzer uses up to date."
    >
      {route.scope === 'run' ? (
        <ProjectLanding slug={slug} onGuidance={() => route.setScope('categories')} />
      ) : (
        <GuidanceArea scope={scope} slug={slug} canManage={manage} tab={route.scope} />
      )}
    </AnalyzerFrame>
  );
}
