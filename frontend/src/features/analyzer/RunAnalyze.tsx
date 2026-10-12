import { useEffect, useRef, useState } from 'react';
import type { AnalysisConfig } from '@/api/analysis';
import { isJobTerminal } from '@/api/analysis';
import { useDelayedPending } from '@/lib/pending';
import { Button, Chip, EmptyState, ErrorState, Icon, ConfirmDialog, Select, Skeleton, Text } from '@/ui';
import { Card } from './blocks/Card';
import { FieldsMapping } from './blocks/FieldsMapping';
import { Instructions } from './blocks/Instructions';
import { JobStatus } from './blocks/JobStatus';
import { MetricChips } from './blocks/MetricChips';
import { PromptPreview } from './blocks/PromptPreview';
import { RunBar } from './blocks/RunBar';
import { RunHeader } from './blocks/RunHeader';
import { SamplePicker } from './blocks/SamplePicker';
import { TargetFilters, TargetList } from './blocks/Targets';
import { TestResults } from './blocks/TestResults';
import { STEP_IDS, type StepId } from './steps';
import type { RunnerState } from './useAnalysisRunner';
import type { useAnalyzerRoute } from './useAnalyzerRoute';
import { useRunData } from './workspace/useRunData';
import { useRunWorkspace, type RunWorkspace } from './workspace/useRunWorkspace';
import s from './analyzer.module.css';

const STEPS: Array<{ id: StepId; label: string; hint: string }> = [
  { id: 'configure', label: 'Configure', hint: 'Run, metrics, instructions, targets' },
  { id: 'preview', label: 'Preview', hint: 'Fields and the exact prompt' },
  { id: 'run', label: 'Run', hint: 'Test, then analyze' },
  { id: 'review', label: 'Review', hint: 'Results and errors' },
];

export function RunAnalyze({
  slug,
  runId,
  config,
  route,
  runner,
  step,
  onStep,
}: {
  slug: string;
  runId: string;
  config: AnalysisConfig;
  route: ReturnType<typeof useAnalyzerRoute>;
  runner: RunnerState;
  step: StepId;
  onStep: (s: StepId) => void;
}) {
  const [bodies, setBodies] = useState(step === 'preview');
  const data = useRunData(runId, route.pass, bodies || step === 'preview');
  const skeleton = useDelayedPending(data.isPending);
  if (data.isError)
    return <ErrorState error={data.error} title="Couldn’t load this run" onRetry={data.refetch} />;
  if (data.isPending || !data.run) return skeleton ? <Skeleton kind="cards" label="Loading run" /> : null;
  if (data.needsPass) return <SamplePicker passes={data.passes} onPick={route.setPass} />;
  return (
    <Workspace
      key={`${runId}:${data.pass ?? ''}`}
      slug={slug}
      runId={runId}
      config={config}
      route={route}
      runner={runner}
      data={data}
      step={step}
      onStep={(next) => {
        if (next === 'preview') setBodies(true);
        onStep(next);
      }}
    />
  );
}

function Workspace({
  slug,
  runId,
  config,
  route,
  runner,
  data,
  step,
  onStep,
}: {
  slug: string;
  runId: string;
  config: AnalysisConfig;
  route: ReturnType<typeof useAnalyzerRoute>;
  runner: RunnerState;
  data: ReturnType<typeof useRunData>;
  step: StepId;
  onStep: (s: StepId) => void;
}) {
  const ws = useRunWorkspace({ runId, data, config, preselectMetric: route.metric || null }, runner);
  const idx = STEPS.findIndex((x) => x.id === step);
  const run = data.run!;
  const live = Boolean(runner.job && !isJobTerminal(runner.job.status));
  const mapped = ws.customVars.length
    ? `${ws.customVars.length} variable${ws.customVars.length === 1 ? '' : 's'}`
    : 'Default fields';
  const notes: Record<StepId, string> = {
    configure:
      ws.settings.selectedMetrics.length === 0
        ? 'Pick a metric'
        : `${ws.targetCount} ${ws.targetCount === 1 ? 'target' : 'targets'}`,
    preview: mapped,
    run: live
      ? `${runner.job?.progress.completed}/${runner.job?.progress.total}`
      : ws.test.outcome
        ? `${ws.test.outcome.results.length} tested`
        : 'Not run',
    review: runner.job && !live ? (runner.job.status === 'completed' ? 'Complete' : runner.job.status) : '',
  };
  const done: Record<StepId, boolean> = {
    configure: false,
    preview: false,
    run: Boolean(runner.job && !live),
    review: runner.job?.status === 'completed',
  };

  return (
    <div className={s.flow}>
      {config.can_operate_analyzer && !config.llm_configured ? (
        <div className={s.banner} role="status">
          <Icon name="info" size={14} />
          <Text variant="base" tone="secondary" as="span">
            No LLM connection is set up for this project. Preview works, but Test and Analyze need a
            connection in project settings.
          </Text>
        </div>
      ) : !config.can_operate_analyzer ? (
        <div className={s.banner} role="status">
          <Icon name="info" size={14} />
          <Text variant="base" tone="secondary" as="span">
            You can view this analysis setup. Only project managers and the run’s owner can upload documents
            or run analysis, and only managers can change rules.
          </Text>
        </div>
      ) : null}
      <ol className={s.stepper} aria-label="Analysis steps">
        {STEPS.map((st, i) => (
          <li key={st.id}>
            <button
              type="button"
              className={s.step}
              aria-current={st.id === step ? 'step' : undefined}
              data-done={done[st.id] ? '' : undefined}
              onClick={() => onStep(st.id)}
            >
              <span className={s.stepNum} aria-hidden="true">
                {done[st.id] && st.id !== step ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className={s.stepText}>
                <Text variant="md" weight={600} as="span">
                  {st.label}
                </Text>
                <Text variant="sm" tone="muted" as="span">
                  {notes[st.id] || st.hint}
                </Text>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className={s.stepBody}>
        {step === 'configure' ? (
          <div className={s.col}>
            <Card title="Run and metrics">
              <div className={s.stack}>
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
            </Card>
            <Card
              title="Additional instructions"
              description="Optional guidance for this analysis. Detected {variables} are mapped right here."
            >
              <Instructions ws={ws} bodiesLoading={data.bodiesLoading} />
            </Card>
            <Card
              title="Targets"
              description="The limit is applied to the most severe matching item–metric targets. Task and metric errors are never analyzed."
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
                <TargetList ws={ws} slug={slug} />
                <Text variant="sm" tone="muted" as="p">
                  Check up to 3 targets to test them together on the Run step.
                </Text>
              </div>
            </Card>
          </div>
        ) : null}

        {step === 'preview' ? <PreviewStep ws={ws} bodiesLoading={data.bodiesLoading} /> : null}
        {step === 'run' ? <RunStep ws={ws} config={config} onStep={onStep} /> : null}

        {step === 'review' ? (
          <div className={s.col}>
            {runner.job ? (
              <JobStatus runner={runner} slug={slug} runId={runId} mode="card" />
            ) : (
              <EmptyState
                title="Nothing to review yet"
                body="Run an analysis to see the outcome, error groups and a link to the run."
                action={
                  <Button variant="accent" onPress={() => onStep('run')}>
                    Go to Run
                  </Button>
                }
              />
            )}
            {runner.startError ? (
              <Text variant="base" tone="danger" as="p" role="alert">
                {runner.startError}
              </Text>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className={s.nav}>
        <Button
          isDisabled={idx === 0}
          onPress={() => onStep(STEP_IDS[idx - 1] as StepId)}
          icon={<Icon name="prev" size={12} className={s.dirIcon} />}
        >
          Back
        </Button>
        <Text variant="sm" tone="muted" as="span">
          {`Step ${idx + 1} of ${STEPS.length}: ${STEPS[idx]?.hint}`}
        </Text>
        {idx < STEPS.length - 1 ? (
          <Button
            variant="accent"
            onPress={() => onStep(STEP_IDS[idx + 1] as StepId)}
            iconEnd={<Icon name="next" size={12} className={s.dirIcon} />}
          >
            {`Next: ${STEPS[idx + 1]?.label}`}
          </Button>
        ) : (
          <Button variant="accent" onPress={() => onStep('configure')}>
            Back to Configure
          </Button>
        )}
      </footer>

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

function PreviewStep({ ws, bodiesLoading }: { ws: RunWorkspace; bodiesLoading: boolean }) {
  const items = ws.allKeys.map((k) => {
    const [itemId = '', metric = ''] = k.split('\u0000');
    const score = ws.rowById.get(itemId)?.metric_scores[metric];
    return { key: k, label: `${itemId} · ${metric}${score != null ? ` ${score.toFixed(2)}` : ''}` };
  });
  return (
    <div className={s.col}>
      <div className={s.previewPick}>
        <Select
          label="Previewed target"
          items={items}
          value={ws.focusKey}
          onChange={(k) => k != null && ws.setFocusKey(String(k))}
          width={300}
          isDisabled={items.length === 0}
          placeholder="No targets"
        />
        <Text variant="sm" tone="muted" as="span">
          Edit the fields on the left; the prompt on the right updates after a moment.
        </Text>
      </div>
      <div className={s.split}>
        <Card title="Fields" description="What each variable reads from the item.">
          <FieldsMapping ws={ws} bodiesLoading={bodiesLoading} />
        </Card>
        <Card title="Prompt preview" description="No LLM call is made.">
          <PromptPreview ws={ws} />
        </Card>
      </div>
    </div>
  );
}

function RunStep({
  ws,
  config,
  onStep,
}: {
  ws: RunWorkspace;
  config: AnalysisConfig;
  onStep: (s: StepId) => void;
}) {
  const results = useRef<HTMLDivElement>(null);
  const outcomeAt = ws.test.outcome?.at;
  // Point at the result when a test finishes.
  useEffect(() => {
    if (outcomeAt) results.current?.focus();
  }, [outcomeAt]);
  const labels = (ws.testKeys.length ? ws.testKeys : ws.focusKey ? [ws.focusKey] : []).map((k) => {
    const [itemId = '', metric = ''] = k.split('\u0000');
    return { key: k, label: `${itemId} · ${metric}`, explicit: ws.testKeys.includes(k) };
  });
  return (
    <div className={s.col}>
      <Card
        title="Connection and actions"
        description="Test up to 3 targets first; a test saves nothing. Analyze runs in the background."
      >
        <div className={s.stack}>
          <div className={s.testTargets}>
            <Text variant="sm" tone="muted" as="span">
              Testing:
            </Text>
            {labels.length ? (
              labels.map((l) => (
                <Chip
                  key={l.key}
                  isSelected
                  onChange={() => l.explicit && ws.toggleTest(l.key)}
                  onRemove={l.explicit ? () => ws.toggleTest(l.key) : undefined}
                  removeLabel={`Stop testing ${l.label}`}
                >
                  {l.label}
                </Chip>
              ))
            ) : (
              <Text variant="sm" tone="muted" as="span">
                no targets
              </Text>
            )}
            <Button size="sm" onPress={() => onStep('configure')}>
              Change targets
            </Button>
            <Text variant="sm" tone="muted" as="span">
              Up to 3 per test.
            </Text>
          </div>
          <RunBar ws={ws} config={config} />
          {ws.runner.startError ? (
            <Text variant="base" tone="danger" as="p" role="alert">
              {ws.runner.startError}
            </Text>
          ) : null}
        </div>
      </Card>
      <div ref={results} tabIndex={-1} className={s.results} aria-label="Test results">
        <Card title="Test results">
          <TestResults ws={ws} />
        </Card>
      </div>
    </div>
  );
}
