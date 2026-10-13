import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AnalysisConfig } from '@/api/analysis';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ConfirmDialog, Disclosure, ErrorState, Skeleton, Tag } from '@/ui';
import { ActionRail } from './blocks/ActionRail';
import { Card } from './blocks/Card';
import { FieldsMapping } from './blocks/FieldsMapping';
import { Instructions } from './blocks/Instructions';
import { MetricChips } from './blocks/MetricChips';
import { PreviewDrawer } from './blocks/PreviewDrawer';
import { ResultsSlot } from './blocks/ResultsSlot';
import { RunHeader } from './blocks/RunHeader';
import { SamplePicker } from './blocks/SamplePicker';
import { TargetFilters, TargetList } from './blocks/Targets';
import { mappingSummary } from './model/settings';
import { useAnalysisPhase } from './useAnalysisPhase';
import type { RunnerState } from './useAnalysisRunner';
import type { useAnalyzerRoute } from './useAnalyzerRoute';
import { useRunData, type RunData } from './workspace/useRunData';
import { useRunWorkspace } from './workspace/useRunWorkspace';
import s from './analyzer.module.css';

type Route = ReturnType<typeof useAnalyzerRoute>;

interface Common {
  slug: string;
  runId: string;
  config: AnalysisConfig;
  route: Route;
  runner: RunnerState;
}

/** Skeleton shaped like the real page (Setup block, then ten target rows) so content lands in place. */
function LoadingLayout() {
  return (
    <div className={s.flow} aria-busy="true">
      <Skeleton kind="rows" rows={1} rowHeight={220} label="Loading setup" />
      <Skeleton kind="rows" rows={10} rowHeight={40} label="Loading targets" />
    </div>
  );
}

/** Keeps the previous sample on screen (dimmed, not interactive) while another sample loads. */
function Dimmed({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (el) el.inert = true;
  }, []);
  return (
    <div ref={ref} className={s.dimmed} aria-busy="true">
      {children}
    </div>
  );
}

/** The single-page Analyze-run workspace: Setup, Targets, Results and the sticky action rail. */
export function RunAnalyze(props: Common) {
  const { runId, route } = props;
  const [bodies, setBodies] = useState(false);
  const data = useRunData(runId, route.pass, bodies);
  const skeleton = useDelayedPending(data.isPending);
  const ready = !data.isPending && Boolean(data.run) && !data.needsPass && !data.isError;
  const [shown, setShown] = useState<{ key: string; data: RunData } | null>(null);
  const key = `${runId}:${data.pass ?? ''}`;
  // Remember the last loaded sample (set during render: it is derived from `data`, not a side effect).
  if (ready && (shown?.key !== key || shown.data.rows !== data.rows)) setShown({ key, data });
  if (data.isError)
    return <ErrorState error={data.error} title="Couldn’t load this run" onRetry={data.refetch} />;
  if (data.isPending || !data.run) {
    const held = shown;
    if (held)
      return (
        <Dimmed>
          <Workspace key={held.key} {...props} data={held.data} onNeedBodies={() => undefined} />
        </Dimmed>
      );
    return skeleton ? <LoadingLayout /> : null;
  }
  if (data.needsPass) return <SamplePicker passes={data.passes} onPick={route.setPass} />;
  return <Workspace key={key} {...props} data={data} onNeedBodies={() => setBodies(true)} />;
}

function Workspace({
  slug,
  runId,
  config,
  route,
  runner,
  data,
  onNeedBodies,
}: Common & { data: RunData; onNeedBodies: () => void }) {
  const ws = useRunWorkspace({ runId, data, config, preselectMetric: route.metric || null }, runner);
  const phase = useAnalysisPhase(runner, ws.test.testing);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const previewOpen = params.get('preview') === '1';
  const run = data.run!;
  const results = useRef<HTMLDivElement>(null);
  const [mappingOpen, setMappingOpen] = useState(false);

  // Item bodies (JSON field pickers) are only needed once a mapping is on screen.
  const needsBodies = mappingOpen || ws.customVars.length > 0;
  useEffect(() => {
    if (needsBodies) onNeedBodies();
  }, [needsBodies, onNeedBodies]);

  // Legacy `?step=`: preview opens the drawer, run / review scroll to Results; then the param is dropped.
  const legacyStep = useRef(params.get('step'));
  useEffect(() => {
    const step = legacyStep.current;
    if (!step) return;
    legacyStep.current = null;
    if (step === 'preview') replaceUrlQuery({ step: null, preview: 1 });
    else {
      replaceUrlQuery({ step: null });
      if (step === 'run' || step === 'review') results.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [replaceUrlQuery]);

  // A test or a job starting brings the Results section into view (no focus change; the rail announces it).
  const phaseName = phase.phase;
  useEffect(() => {
    if (phaseName === 'testing' || phaseName === 'starting')
      results.current?.scrollIntoView?.({ block: 'nearest' });
  }, [phaseName]);

  const setPreview = (open: boolean) => replaceUrlQuery({ preview: open ? 1 : null });
  const previewTarget = (key: string) => {
    ws.setFocusKey(key);
    setPreview(true);
  };

  return (
    <div className={s.flow}>
      <Card title="Setup" id="analysis-setup">
        <div className={s.setupGrid}>
          <div className={s.group}>
            <RunHeader
              slug={slug}
              runId={runId}
              run={run}
              passes={data.passes}
              pass={data.pass}
              onPass={route.setPass}
              busy={ws.busy}
            />
            <MetricChips
              metrics={data.metricNames}
              selected={ws.settings.selectedMetrics}
              onChange={(next) => ws.update({ selectedMetrics: next })}
            />
          </div>
          <div className={s.group}>
            <Instructions ws={ws} bodiesLoading={data.bodiesLoading} />
          </div>
          <div className={s.groupWide}>
            <Disclosure
              title="Input mapping"
              summary={mappingSummary(ws.settings, ws.customVars.length)}
              open={mappingOpen}
              onOpenChange={setMappingOpen}
            >
              <FieldsMapping ws={ws} bodiesLoading={data.bodiesLoading} onlyStandard />
            </Disclosure>
          </div>
        </div>
      </Card>

      <Card
        title="Targets"
        description="The limit is applied to the most severe matching item–metric targets. Task and metric errors are never analyzed."
        aside={<Tag kind="count">{ws.targetCount}</Tag>}
        id="analysis-targets"
      >
        <div className={s.stack}>
          <TargetFilters
            ws={ws}
            maxTimeout={config.analysis_defaults.max_timeout_seconds}
            maxRetries={config.analysis_defaults.max_timeout_retries}
            defaults={{
              timeoutSeconds: config.analysis_defaults.request_timeout_seconds || 120,
              maxIssues: config.max_root_cause_categories || 3,
            }}
          />
          <TargetList ws={ws} slug={slug} onPreview={previewTarget} />
        </div>
      </Card>

      <ResultsSlot ref={results} ws={ws} phase={phase} />

      <ActionRail
        ws={ws}
        config={config}
        phase={phase}
        slug={slug}
        runId={runId}
        onPreview={() => setPreview(true)}
      />
      <PreviewDrawer ws={ws} open={previewOpen} onOpenChange={setPreview} />

      <ConfirmDialog
        open={ws.humanConfirm !== null}
        onOpenChange={(open) => !open && ws.cancelHumanConfirm()}
        title="Overwrite human diagnoses?"
        description={
          ws.humanConfirm
            ? [
                `This will replace ${ws.humanConfirm.count} human metric ${ws.humanConfirm.count === 1 ? 'diagnosis' : 'diagnoses'} with new AI results.`,
                `Metrics affected: ${ws.humanConfirm.metrics.join(', ')}.`,
              ]
            : undefined
        }
        note="Continue only if you intentionally want to replace reviewer corrections."
        cancelLabel="Keep human labels"
        confirmLabel="Re-analyze human labels"
        tone="danger"
        onConfirm={() => void ws.confirmHuman()}
      />
    </div>
  );
}
