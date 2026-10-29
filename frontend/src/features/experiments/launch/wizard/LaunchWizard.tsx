import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Card, Skeleton, Stepper } from '@/ui';
import { plural } from '../../lib/format';
import { EntryBlock } from '../entry/EntryBlock';
import { StartFrom } from '../entry/StartFrom';
import { StaticSections } from '../components/LaunchSection';
import panel from '../components/launch.module.css';
import { useLaunch } from '../LaunchContext';
import styles from '../LaunchPage.module.css';
import {
  axesOf,
  buildSpec,
  datasetChanged,
  defaultRunPriority,
  diffCount,
  highRunCount,
  launchLabel,
} from '../model';
import { StepsBar, type BarPrimary } from '../review/LaunchBar';
import barStyles from '../review/launchBar.module.css';
import { ReviewStep } from '../review/ReviewStep';
import { EvaluationSection } from '../sections/EvaluationSection';
import { ModelsSection } from '../sections/ModelsSection';
import { RawJsonSection } from '../sections/RawJsonSection';
import { SettingsSection } from '../sections/SettingsSection';
import { SweepsSection } from '../sections/SweepsSection';
import { prefersReducedMotion } from '../state/useSections';
import { StepPanel } from './StepPanel';
import { stepLabel, stepOfItem, WIZARD_STEPS, type WizardStepDef, type WizardStepId } from './steps';
import wizard from './wizard.module.css';

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

export interface WizardProps {
  /** `launch` = Customize an experiment; `editor` = the default-preset editor (the same wizard, another step set). */
  mode?: 'launch' | 'editor';
  steps?: readonly WizardStepDef[];
  step: WizardStepId;
  onGo: (step: WizardStepId) => void;
  /** Back from the first step: the start view (launch) or the environment page (editor). */
  onBack: () => void;
  onCancel: () => void;
  /** The bar's primary action (default: Launch N runs). */
  primary?: BarPrimary;
  /** The bar's status slot (default: the run count and the first problem). */
  status?: ReactNode;
  /** A step's own body (editor: Environment and dataset); `undefined` = the shared body. */
  renderStep?: (step: WizardStepId) => ReactNode | undefined;
  /** The review step's body (editor: Review and publish); default: the launch review. */
  review?: ReactNode;
}

/** The bar's status slot in launch mode: the run count and the first problem (a link that opens its step), or Ready. */
function LaunchStatus({ onGo, needsAck }: { onGo: (step: WizardStepId) => void; needsAck: boolean }) {
  const { review, focusIssue } = useLaunch();
  const first = review.items[0];
  return (
    <>
      <span className={barStyles.runs} aria-live="polite">
        {plural(review.count.runs, 'run')} to launch
      </span>
      {first ? (
        <button type="button" className={barStyles.problem} onClick={() => focusIssue(first)}>
          {`Fix ${plural(review.items.length, 'problem')} first`}
          <span className={barStyles.long}>{`: ${first.label}`}</span>
        </button>
      ) : needsAck ? (
        <button
          type="button"
          className={barStyles.problem}
          data-part="bar-ack"
          onClick={() => {
            onGo('review');
            setTimeout(() => document.querySelector<HTMLElement>('[data-part=review-ack] input')?.focus(), 0);
          }}
        >
          Acknowledge the preemption to launch
        </button>
      ) : (
        <span className={barStyles.ok}>{review.status || 'Ready'}</span>
      )}
    </>
  );
}

/**
 * Customize: the wizard. One step on screen at a time over a progress rail and one bottom bar with the same
 * slots on every step. The review lives on its own step; the other steps show their own content full width.
 * The default-preset editor mounts it with `mode="editor"` (another step set, review and primary action).
 */
export function LaunchWizard({
  mode = 'launch',
  steps: stepList = WIZARD_STEPS,
  step,
  onGo,
  onBack,
  onCancel,
  primary,
  status,
  renderStep,
  review: reviewBody,
}: WizardProps) {
  const { doc, ctx, review, flags, sectionSummary, isLaunching, launch, readOnly, preview, preemptionAck } = useLaunch();
  const swept = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length,
    [doc, ctx.evaluatorPanel],
  );
  const hasEnv = doc.environmentIds.length > 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const [badgeSlot, setBadgeSlot] = useState<HTMLElement | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const announce = useMemo(() => {
    const index = stepList.findIndex((s) => s.id === step) + 1;
    return `Step ${index} of ${stepList.length}: ${stepLabel(step, stepList)}`;
  }, [step, stepList]);

  // A step change: the rail comes to the top of the view and the heading takes focus. The stage keeps
  // the previous step's height until the scroll ends, so a shorter step cannot clamp the scroll to 0
  // and make it jump back down to the rail.
  const stage = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const held = useRef(false);
  const firstStep = useRef(true);
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      if (!held.current) lastHeight.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = stage.current;
    const smooth = !prefersReducedMotion();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (el && !firstStep.current && lastHeight.current) {
      held.current = true;
      el.style.minHeight = `${lastHeight.current}px`;
      timer = setTimeout(
        () => {
          el.style.minHeight = '';
          held.current = false;
        },
        smooth ? 700 : 50,
      );
    }
    const wasFirst = firstStep.current;
    firstStep.current = false;
    // The shell scrolls its content area to the top on every pushed location, after this effect.
    // Read the offset now and put it back in a microtask, then glide to the rail from where the
    // user was (no flash to the top first).
    const scroller = scrollParent(rail.current);
    const before = scroller?.scrollTop ?? 0;
    queueMicrotask(() => {
      if (scroller && !wasFirst) scroller.scrollTop = before;
      rail.current?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    });
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [step]);

  const problemsByStep = useMemo(() => {
    const out: Partial<Record<WizardStepId, number>> = {};
    for (const item of review.items) {
      const s = stepOfItem(item);
      out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  }, [review.items]);
  const steps = stepList.map((s) => {
    let changes = 0;
    if (s.id === 'where')
      changes =
        (datasetChanged(doc) ? 1 : 0) +
        diffCount(doc).shape +
        diffCount(doc).tasks +
        (doc.priority ? 1 : 0) +
        (doc.latencySensitive ? 1 : 0);
    else if (s.id === 'models') changes = sectionSummary('models').changes;
    else if (s.id === 'settings') changes = sectionSummary('settings').changes + swept;
    else if (s.id === 'evaluation') changes = sectionSummary('evaluation').changes;
    return { id: s.id, label: s.label, changes, problems: problemsByStep[s.id] ?? 0 };
  });

  const loading = hasEnv && flags.envsLoading;
  const editor = mode === 'editor';
  const custom = renderStep?.(step);
  let body;
  switch (step) {
    case 'where':
      body = (
        <StepPanel
          key={step}
          ref={heading}
          stepId={step}
          title={stepLabel(step, stepList)}
          description={
            editor
              ? 'What the draft is compared with, the task and the dataset.'
              : 'Name the experiment, set its priority and pick the task, the environments and the dataset.'
          }
        >
          {custom ?? <EntryBlock />}
        </StepPanel>
      );
      break;
    case 'start':
      body = (
        <StepPanel
          key={step}
          ref={heading}
          stepId={step}
          title="Starting point"
          description="What the experiment starts from. Your changes are applied on top of it."
        >
          {hasEnv ? (
            <Card>
              <div className={panel.cardStack}>
                <StartFrom />
              </div>
            </Card>
          ) : (
            <p className={styles.hint}>Pick an environment first (step 1) to choose a starting point.</p>
          )}
        </StepPanel>
      );
      break;
    case 'review':
      body = (
        <StepPanel
          key={step}
          ref={heading}
          stepId={step}
          title={stepLabel(step, stepList)}
          description={
            editor
              ? 'Check the summary, write the release notes, then publish.'
              : 'Check the summary and set a priority per run, then launch.'
          }
        >
          {reviewBody ?? <ReviewStep />}
          {hasEnv ? (
            <StaticSections>
              <RawJsonSection />
            </StaticSections>
          ) : null}
        </StepPanel>
      );
      break;
    default: {
      const title = stepLabel(step, stepList);
      body = (
        <StepPanel key={step} ref={heading} stepId={step} title={title} onBadgeSlot={setBadgeSlot}>
          {!hasEnv ? (
            <p className={styles.hint}>Pick an environment first (step 1) to configure this step.</p>
          ) : loading ? (
            <Skeleton kind="cards" count={3} label="Loading the environments’ settings" />
          ) : (
            <StaticSections
              badgeSlot={badgeSlot}
              untitled={step === 'models' ? ['models'] : step === 'settings' ? ['settings'] : ['evaluation']}
            >
              {step === 'models' ? <ModelsSection /> : null}
              {step === 'settings' ? (
                <>
                  <SettingsSection />
                  {swept && !editor ? <SweepsSection /> : null}
                </>
              ) : null}
              {step === 'evaluation' ? <EvaluationSection /> : null}
            </StaticSections>
          )}
        </StepPanel>
      );
    }
  }

  // Priority: the review step's acknowledgement is needed while any run is High (launch mode only).
  const highRuns = editor ? 0 : highRunCount(doc, preview.data?.jobs, defaultRunPriority(doc, ctx, preview.data));
  const needsAck = highRuns > 0 && !preemptionAck;
  const launchPrimary: BarPrimary = primary ?? {
    label: launchLabel(review.count.runs, isLaunching),
    disabled: readOnly || !review.canLaunch || review.items.length > 0 || needsAck,
    loading: isLaunching,
    onPress: () => void launch(),
  };
  return (
    <div className={styles.layout} data-part="customize" data-mode={mode}>
      <div className={styles.main}>
        <div ref={rail} className={wizard.rail}>
          <Stepper
            aria-label="Steps"
            steps={steps}
            current={step}
            onSelect={(id) => onGo(id as WizardStepId)}
          />
        </div>
        <div className={wizard.live} role="status" aria-live="polite">
          {announce}
          {review.items.length ? `, ${plural(review.items.length, 'problem')} to fix` : ''}
        </div>
        <div ref={stage}>{body}</div>
        <StepsBar
          steps={stepList}
          step={step}
          onBack={onBack}
          onGo={onGo}
          onCancel={onCancel}
          primary={launchPrimary}
          status={status ?? <LaunchStatus onGo={onGo} needsAck={needsAck && review.items.length === 0} />}
        />
      </div>
    </div>
  );
}
