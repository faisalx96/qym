import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@/features/shell';
import { Card, Skeleton, Stepper } from '@/ui';
import { plural } from '../../lib/format';
import { EntryBlock } from '../entry/EntryBlock';
import { StartFrom } from '../entry/StartFrom';
import { StaticSections } from '../components/LaunchSection';
import panel from '../components/launch.module.css';
import { useLaunch } from '../LaunchContext';
import styles from '../LaunchPage.module.css';
import { axesOf, buildSpec, datasetChanged } from '../model';
import { ReviewPane } from '../review/ReviewPane';
import { WizardBar } from '../review/WizardBar';
import { EvaluationSection } from '../sections/EvaluationSection';
import { ModelsSection } from '../sections/ModelsSection';
import { RawJsonSection } from '../sections/RawJsonSection';
import { SettingsSection } from '../sections/SettingsSection';
import { SweepsSection } from '../sections/SweepsSection';
import { prefersReducedMotion } from '../state/useSections';
import { StepNav } from './StepNav';
import { StepPanel } from './StepPanel';
import { stepLabel, stepOfItem, WIZARD_STEPS, type WizardStepId } from './steps';
import wizard from './wizard.module.css';

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

interface Props {
  step: WizardStepId;
  next: WizardStepId | null;
  prev: WizardStepId | null;
  onGo: (step: WizardStepId) => void;
  onCancel: () => void;
}

/** Customize: the six-step wizard. One step on screen at a time over a progress rail; the review stays in view. */
export function LaunchWizard({ step, next, prev, onGo, onCancel }: Props) {
  const { doc, ctx, review, flags, sectionSummary } = useLaunch();
  const wide = useMediaQuery('(min-width: 1200px)');
  const swept = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length,
    [doc, ctx.evaluatorPanel],
  );
  const hasEnv = doc.environmentIds.length > 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const [badgeSlot, setBadgeSlot] = useState<HTMLElement | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const announce = useMemo(() => {
    const index = WIZARD_STEPS.findIndex((s) => s.id === step) + 1;
    return `Step ${index} of ${WIZARD_STEPS.length}: ${stepLabel(step)}`;
  }, [step]);

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
  const steps = WIZARD_STEPS.map((s) => {
    let changes = 0;
    if (s.id === 'where')
      changes = (datasetChanged(doc) ? 1 : 0) + (doc.priority ? 1 : 0) + (doc.versioningText.trim() ? 1 : 0);
    else if (s.id === 'models') changes = sectionSummary('models').changes;
    else if (s.id === 'settings') changes = sectionSummary('settings').changes + swept;
    else if (s.id === 'evaluation') changes = sectionSummary('evaluation').changes;
    return { id: s.id, label: s.label, changes, problems: problemsByStep[s.id] ?? 0 };
  });

  const loading = hasEnv && flags.envsLoading;
  let body;
  switch (step) {
    case 'where':
      body = (
        <StepPanel
          key={step}
          ref={heading}
          stepId={step}
          title="Where it runs"
          description="Name the experiment, set its priority and pick the environments and dataset."
        >
          <EntryBlock />
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
          title="Review and launch"
          description="Check the summary, then launch."
        >
          <ReviewPane onCancel={onCancel} rawAction={false} />
          {hasEnv ? (
            <StaticSections>
              <RawJsonSection />
            </StaticSections>
          ) : null}
        </StepPanel>
      );
      break;
    default: {
      const title = stepLabel(step);
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
                  {swept ? <SweepsSection /> : null}
                </>
              ) : null}
              {step === 'evaluation' ? <EvaluationSection /> : null}
            </StaticSections>
          )}
        </StepPanel>
      );
    }
  }

  // The settings step holds wide override tables: it takes the full width and the review shrinks to the launch
  // bar (plus the summary under the step), instead of a 22rem rail that clips the table's right columns.
  const compactReview = step === 'settings';
  const showAside = wide && step !== 'review' && !compactReview;
  const reviewBelow = !showAside && step !== 'review';
  return (
    <div
      className={`${styles.layout} ${showAside ? '' : styles.layoutSingle}`}
      data-compact-review={compactReview ? '' : undefined}
    >
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
        {reviewBelow ? (
          <>
            <ReviewPane onCancel={onCancel} hideActions />
            <WizardBar step={step} next={next} prev={prev} onGo={onGo} onCancel={onCancel} />
          </>
        ) : (
          <StepNav step={step} next={next} prev={prev} onGo={onGo} />
        )}
      </div>
      {showAside ? (
        <div className={styles.aside}>
          <ReviewPane onCancel={onCancel} />
        </div>
      ) : null}
    </div>
  );
}
