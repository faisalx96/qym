/**
 * New run: five steps in which a person sets up a load test (target and sign-in, test, load, questions,
 * review and start). Nothing runs until the Start dialog is confirmed; after a start the page goes to the
 * run's own page. The API decides what a person may do and refuses a start that is not ready: the checks
 * here say the same before the button is pressed.
 */
import { useContext, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  isPerformanceSwitchedOff,
  usePerformanceDatasetTiers,
  usePerformanceDatasets,
  useStartPerformanceRun,
  type PerformancePlanInput,
  type PerformanceSetup,
  type PerformanceSetupTarget,
} from '@/api/performance';
import {
  useMixedPerformanceSetup,
  isPlatformTarget,
  type PlatformSetup,
  type PlatformTarget,
} from '@/api/performancePlatform';
import { PlatformNewRun } from './components/platform/PlatformNewRun';
import { performancePath, performanceRunPath } from '@/app/routes';
import { BarButton, LaunchBar } from '@/features/experiments/launch/review/LaunchBar';
import barStyles from '@/features/experiments/launch/review/launchBar.module.css';
import { AuthContext } from '@/features/shell/AuthContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import {
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Icon,
  InlineNotice,
  PageHeader,
  Stepper,
  Text,
  TextLink,
} from '@/ui';
import { LoadStep, TestStep } from './components/new/LoadStep';
import { QuestionsStep } from './components/new/QuestionsStep';
import { ReviewStep, SoFar, SoFarFrame, StartDialog, type RunSummary } from './components/new/ReviewStep';
import { TargetDialog, type TargetForm } from './components/new/TargetDialog';
import { TargetStep, TargetStepFrame } from './components/new/TargetStep';
import { UploadDialog } from './components/new/UploadDialog';
import { RUNNER_CODES, refusalCode, startErrorWords } from './components/new/errors';
import {
  STEPS,
  datasetMix,
  effectiveMix,
  initialDraft,
  problemsOf,
  runChecks,
  startRequest,
  stepAbout,
  type NewRunDraft,
  type StepNumber,
} from './components/new/model';
import styles from './components/new/newRun.module.css';
import { KINDS } from './lib/format';
import { computePlan } from './lib/plan';

/** Where the page opens: a link from another page ("Run on this target"), the gallery, a test. */
export interface NewRunInitial {
  step?: StepNumber;
  targetId?: string;
  /** A dialog that is open from the start. */
  dialog?: 'add-target' | 'upload' | 'start';
  /** With `dialog: 'upload'`: a file that is already read, so the dialog opens on Fields. */
  uploadFile?: { name: string; text: string };
  /** With `dialog: 'add-target'`: what the form of the new target holds when it opens. */
  targetForm?: Partial<TargetForm>;
}

export function NewRunPage({ slug, initial }: { slug: string; initial?: NewRunInitial }) {
  useDocumentTitle('New run · Performance');
  return (
    <div className={fullWidth}>
      <NewRunView slug={slug} initial={initial} />
    </div>
  );
}

/** The page without its outer padding: header, steps, the step card and the summary. */
export function NewRunView({ slug, initial }: { slug: string; initial?: NewRunInitial }) {
  const setup = useMixedPerformanceSetup(slug);
  const navigate = useNavigate();
  const cancel = () => navigate(performancePath(slug));
  return (
    <div className={styles.page} data-performance-block="content" data-performance-page="new-run">
      <PageHeader
        title="New run"
        description="Set up a load test, look at the plan, then start it. Nothing runs until you confirm."
      />
      <div className={styles.body}>
        {isPerformanceSwitchedOff(setup.error) ? (
          // The area is switched off on the platform: every route answers the same 404. Nothing to retry.
          <EmptyState
            icon={<Icon name="ban" />}
            title="Performance tests are switched off"
            body="An administrator has turned this area off for the platform. New runs can be set up again once it is turned back on."
          />
        ) : setup.data ? (
          <KindNewRunForm
            slug={slug}
            setup={setup.data}
            now={setup.data.received_at}
            initial={initial}
            onCancel={cancel}
          />
        ) : setup.isError ? (
          <ErrorState
            error={setup.error}
            title="Couldn’t load the run settings"
            onRetry={() => void setup.refetch()}
          />
        ) : (
          <NewRunFrame onCancel={cancel} />
        )}
      </div>
    </div>
  );
}

const STEPPER_STEPS = STEPS.map(({ id, label }) => ({ id, label }));

/**
 * The loading frame is the loaded layout of step 1 (DESIGN_LANGUAGE §7): the same steps, step card, summary and bar,
 * with Skeleton shapes where the targets and their sign-in will be. Only Cancel works until the settings are read.
 */
function NewRunFrame({ onCancel }: { onCancel: () => void }) {
  const first = STEPS[0]!;
  return (
    <>
      <Stepper
        aria-label="New run steps"
        steps={STEPPER_STEPS}
        current={first.id}
        onSelect={() => undefined}
      />
      <div className={styles.wizard} aria-busy="true">
        <Card
          as="section"
          aria-label={first.label}
          data-performance-block="step"
          header={<CardTitle title={first.label} description={stepAbout(1, 'breakpoint')} />}
        >
          <TargetStepFrame />
        </Card>
        <SoFarFrame />
      </div>
      <StepBar
        step={1}
        reading
        problems={[]}
        onGo={() => undefined}
        onCancel={onCancel}
        onStart={() => undefined}
      />
    </>
  );
}

/**
 * The bar under the steps: the launch wizard's bar (DESIGN_LANGUAGE §3.2 "Sticky bars", §7), sticky at the bottom
 * while the page is taller than the window. The same five slots on every step: Skip to review and Cancel at the far
 * left, the status in the centre, Back and the primary slot at the far right. A slot that does not apply is disabled.
 */
export function StepBar({
  step,
  problems,
  reading = false,
  onGo,
  onCancel,
  onStart,
  dashboardStep = false,
}: {
  dashboardStep?: boolean;
  step: StepNumber;
  problems: { message: string }[];
  /** The settings are still being read: only Cancel works. */
  reading?: boolean;
  onGo: (step: number) => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const steps = STEPS.map((item, i) => (dashboardStep && i === 3 ? { ...item, label: 'Dashboards' } : item));
  const previous = step > 1 ? steps[step - 2] : undefined;
  const next = steps[step];
  const waiting = 'The run settings are still being read';
  return (
    <div className={styles.barHost} data-performance-block="step-bar">
      <LaunchBar>
        <div className={barStyles.start}>
          <BarButton
            part="bar-skip"
            isDisabled={reading || !next}
            disabledReason={reading ? waiting : 'This is the review'}
            aria-label="Skip to review and start"
            onPress={() => onGo(5)}
          >
            Skip<span className={barStyles.long}> to review</span>
          </BarButton>
          <BarButton part="bar-cancel" onPress={onCancel}>
            Cancel
          </BarButton>
        </div>
        <div className={barStyles.status} data-part="bar-status">
          <Text variant="base" tone="muted">
            {step < 5
              ? `Step ${step} of 5`
              : problems.length
                ? `Start is off until the ${problems.length === 1 ? 'problem' : `${problems.length} problems`} in the checks ${problems.length === 1 ? 'is' : 'are'} fixed.`
                : 'You will be asked to confirm before anything runs.'}
          </Text>
        </div>
        <div className={barStyles.end}>
          <BarButton
            part="bar-back"
            isDisabled={reading || !previous}
            disabledReason={reading ? waiting : 'This is the first step'}
            aria-label={previous ? `Back to ${previous.label}` : undefined}
            onPress={() => onGo(step - 1)}
          >
            Back
          </BarButton>
          {next ? (
            <BarButton
              part="bar-continue"
              data-action="continue"
              className={barStyles.primary}
              isDisabled={reading}
              disabledReason={waiting}
              aria-label={`Continue to ${next.label}`}
              onPress={() => onGo(step + 1)}
            >
              Continue
            </BarButton>
          ) : (
            <BarButton
              part="bar-continue"
              data-action="start"
              variant="primary"
              className={barStyles.primary}
              isDisabled={problems.length > 0}
              disabledReason={problems[0]?.message}
              onPress={onStart}
            >
              Start run
            </BarButton>
          )}
        </div>
      </LaunchBar>
    </div>
  );
}

function KindNewRunForm(props: {
  slug: string;
  setup: PlatformSetup;
  now: number;
  initial?: NewRunInitial;
  onCancel: () => void;
}) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(
    props.initial?.targetId ?? params.get('target') ?? props.setup.targets[0]?.id ?? null,
  );
  const target = props.setup.targets.find((item) => item.id === selected);
  if (target && isPlatformTarget(target))
    return <PlatformNewRun {...props} target={target} onTarget={setSelected} />;
  const chatSetup = {
    ...props.setup,
    targets: props.setup.targets.filter((item) => !isPlatformTarget(item)),
  } as PerformanceSetup;
  return (
    <NewRunForm
      {...props}
      setup={chatSetup}
      initial={{ ...props.initial, targetId: selected ?? undefined }}
      extraTargets={props.setup.targets.filter(isPlatformTarget)}
      onTarget={setSelected}
    />
  );
}

function NewRunForm({
  slug,
  setup,
  now,
  initial,
  onCancel,
  extraTargets,
  onTarget,
}: {
  extraTargets?: PlatformTarget[];
  onTarget?: (id: string) => void;
  slug: string;
  setup: PerformanceSetup;
  now: number;
  initial?: NewRunInitial;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useContext(AuthContext)?.me ?? null;
  const [draft, setDraft] = useState<NewRunDraft>(() =>
    initialDraft(setup, initial?.targetId ?? params.get('target')),
  );
  const [step, setStep] = useState<StepNumber>(initial?.step ?? 1);
  const [reached, setReached] = useState<StepNumber>(initial?.step ?? 1);
  const [targetDialog, setTargetDialog] = useState<{ target: PerformanceSetupTarget | null } | null>(
    initial?.dialog === 'add-target' ? { target: null } : null,
  );
  const [uploadOpen, setUploadOpen] = useState(initial?.dialog === 'upload');
  const [startOpen, setStartOpen] = useState(initial?.dialog === 'start');
  /** Why the last press of Start was refused, in words; shown until Start is pressed again. */
  const [refusal, setRefusal] = useState<{ words: string; runner: boolean } | null>(null);
  /** The target whose saved sign-in a change in the target dialog removed. */
  const [signInCleared, setSignInCleared] = useState<string | null>(null);

  const datasets = usePerformanceDatasets(slug);
  const start = useStartPerformanceRun(slug);

  const target = setup.targets.find((item) => item.id === draft.targetId) ?? null;
  const list = datasets.data?.datasets;
  // Until the person chooses, the first dataset a run could use is the one in use.
  const versionId =
    draft.datasetVersionId ??
    list?.find((item) => item.latest_published_version && item.item_count > 0)?.latest_published_version
      ?.id ??
    null;
  const dataset = list?.find((item) => item.latest_published_version?.id === versionId) ?? null;
  const tiers = usePerformanceDatasetTiers(slug, dataset ? versionId : null);

  const plan = draft.plans[draft.test];
  const computed = useMemo(() => {
    const longest = Math.min(
      setup.limits.max_total_seconds,
      target?.max_duration_s ?? Number.POSITIVE_INFINITY,
    );
    return computePlan(draft.test, plan, {
      max_users: target?.max_users,
      max_users_of: target?.name,
      max_total_seconds: longest,
    });
  }, [
    draft.test,
    plan,
    setup.limits.max_total_seconds,
    target?.max_duration_s,
    target?.max_users,
    target?.name,
  ]);

  const mix = effectiveMix(draft.mix, dataset);
  const checks = runChecks({ setup, target, computed, dataset, tiers: tiers.data ?? null, mix: draft.mix });
  const problems = problemsOf(checks);
  const summary: RunSummary = {
    target,
    test: draft.test,
    computed,
    dataset,
    mix,
    checks,
    person: me ? { id: me.id, name: me.display_name || me.email } : null,
    now,
  };

  const go = (to: number) => {
    const next = Math.min(5, Math.max(1, to)) as StepNumber;
    setStep(next);
    setReached((value) => (next > value ? next : value));
  };
  const current = STEPS[step - 1]!;

  const changePlan = (patch: Partial<PerformancePlanInput>, options?: { timeoutEdited?: boolean }) =>
    setDraft((value) => ({
      ...value,
      plans: { ...value.plans, [value.test]: { ...value.plans[value.test], ...patch } },
      timeoutEdited: options?.timeoutEdited ?? value.timeoutEdited,
    }));

  async function startRun() {
    if (!target) return;
    setRefusal(null);
    try {
      const run = await start.mutateAsync(
        startRequest(
          { ...draft, datasetVersionId: versionId },
          dataset,
          target.is_production ? target.name : undefined,
        ),
      );
      navigate(performanceRunPath(slug, run.id));
    } catch (refused) {
      // The dialog shows the reason; the page keeps it too, for when the dialog is closed.
      // The area is read again after any refused write, so a changed target or runner shows at once.
      const words = startErrorWords(refused);
      setRefusal({ words, runner: RUNNER_CODES.has(refusalCode(refused)) });
      throw new Error(words);
    }
  }

  const body =
    step === 1 ? (
      <TargetStep
        slug={slug}
        setup={setup}
        target={target}
        extraTargets={extraTargets}
        onChoose={(id) => {
          setDraft((value) => ({ ...value, targetId: id }));
          onTarget?.(id);
        }}
        onAdd={() => setTargetDialog({ target: null })}
        onEdit={(item) => setTargetDialog({ target: item })}
      />
    ) : step === 2 ? (
      <TestStep
        test={draft.test}
        onChoose={(test) =>
          setDraft((value) => ({
            ...value,
            test,
            mix: value.mixEdited ? value.mix : { ...setup.defaults[test].mix },
          }))
        }
      />
    ) : step === 3 ? (
      <LoadStep
        test={draft.test}
        plan={plan}
        limits={setup.limits}
        computed={computed}
        timeoutEdited={draft.timeoutEdited}
        onChange={changePlan}
      />
    ) : step === 4 ? (
      <QuestionsStep
        slug={slug}
        datasets={list}
        datasetsError={datasets.isError ? datasets.error : null}
        onRetryDatasets={() => void datasets.refetch()}
        dataset={dataset}
        onChoose={(id) => setDraft((value) => ({ ...value, datasetVersionId: id }))}
        mix={draft.mix}
        usualMix={setup.defaults[draft.test].mix}
        onMix={(value) => setDraft((old) => ({ ...old, mix: value, mixEdited: true }))}
        onUpload={() => setUploadOpen(true)}
      />
    ) : (
      <ReviewStep summary={summary} onGo={go} />
    );

  return (
    <>
      {setup.blocked ? (
        <InlineNotice tone="warning" lead="A run cannot be started right now.">
          {setup.blocked.message}{' '}
          {RUNNER_CODES.has(setup.blocked.code) ? (
            <TextLink to={performancePath(slug, 'runner')}>Runner</TextLink>
          ) : null}
        </InlineNotice>
      ) : null}
      {refusal && !startOpen ? (
        <InlineNotice tone="danger" lead="The run was not started.">
          {refusal.words}{' '}
          {refusal.runner ? <TextLink to={performancePath(slug, 'runner')}>Runner</TextLink> : null}
        </InlineNotice>
      ) : null}
      {step === 1 && target && target.id === signInCleared && !target.sign_in_ready ? (
        <InlineNotice tone="warning" lead="Sign-in removed.">
          The change to {target.name} removed its saved sign-in. Paste the tokens again below.
        </InlineNotice>
      ) : null}
      <Stepper
        aria-label="New run steps"
        steps={STEPPER_STEPS}
        current={current.id}
        onSelect={(id) => go(STEPS.findIndex((item) => item.id === id) + 1)}
      />
      <div className={styles.wizard} data-wide={step === 5 ? '' : undefined}>
        <Card
          as="section"
          aria-label={current.label}
          data-performance-block="step"
          header={<CardTitle title={current.label} description={stepAbout(step, draft.test)} />}
        >
          {body}
        </Card>
        {step === 5 ? null : <SoFar summary={summary} step={step} reached={reached} />}
      </div>
      <StepBar
        step={step}
        problems={problems}
        onGo={go}
        onCancel={onCancel}
        onStart={() => setStartOpen(true)}
      />
      <TargetDialog
        slug={slug}
        open={targetDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTargetDialog(null);
        }}
        target={targetDialog?.target}
        initialForm={targetDialog?.target ? undefined : initial?.targetForm}
        targets={setup.targets}
        maxUsersLimit={setup.limits.max_users[1]}
        onSaved={(saved) => {
          // A new address or sign-in route removes the saved tokens: the person pastes them again.
          const before = targetDialog?.target;
          if (before?.tokens.length && !saved.tokens.length) setSignInCleared(saved.id);
          setDraft((value) => ({ ...value, targetId: saved.id }));
        }}
      />
      <UploadDialog
        slug={slug}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        initialFile={initial?.uploadFile}
        onSaved={(saved, result) =>
          setDraft((value) => {
            // A mix that asks for a kind the new dataset does not have becomes the dataset's own split.
            const misses = KINDS.some((kind) => value.mix[kind] > 0 && !result.tier_counts[kind]);
            return {
              ...value,
              datasetVersionId: saved.version.id,
              ...(misses ? { mix: datasetMix(result.tier_counts), mixEdited: true } : {}),
            };
          })
        }
      />
      {/* Opened only while no check fails; a refusal from the platform keeps it open with the reason. */}
      <StartDialog open={startOpen} onOpenChange={setStartOpen} summary={summary} onStart={startRun} />
    </>
  );
}
