import { useMemo } from 'react';
import { PageHeader, SegmentedControl } from '@/ui';
import { useDocumentTitle } from '@/features/shell/hooks';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { fullWidth } from '@/features/shell/layout';
import { GuidanceArea } from './GuidanceArea';
import { ProjectLanding } from './ProjectLanding';
import { RunShell } from './RunShell';
import { useAnalyzerRoute } from './useAnalyzerRoute';
import s from './analyzer.module.css';

/** /projects/:slug/analysis[?run=&pass=&metric=&scope=] — the auto-analysis workspace. */
export function AnalyzerPage() {
  useDocumentTitle('Auto-analysis');
  const { slug, canManage, readOnly } = useProjectContext();
  const route = useAnalyzerRoute();
  const manage = canManage && !readOnly;
  const scope = useMemo(() => ({ slug, runId: route.runId || undefined }), [slug, route.runId]);

  if (route.runId) return <RunShell key={route.runId} slug={slug} runId={route.runId} canManage={manage} scope={scope} route={route} />;

  const area = route.scope === 'run' ? 'run' : 'guidance';
  return (
    <div className={`${fullWidth} ${s.page}`}>
      <PageHeader
        title="Auto-analysis"
        description="Diagnose failed metric targets, and keep the project guidance the analyzer uses up to date."
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
      </div>
      {area === 'run' ? (
        <ProjectLanding slug={slug} onGuidance={() => route.setScope('categories')} />
      ) : (
        <GuidanceArea scope={scope} slug={slug} canManage={manage} tab={route.scope as 'categories'} onTab={route.setScope} />
      )}
    </div>
  );
}
