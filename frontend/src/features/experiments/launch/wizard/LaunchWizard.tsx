import { useEffect, useMemo, useRef } from 'react';
import { useMediaQuery } from '@/features/shell';
import { Stepper } from '@/ui';
import { plural } from '../../lib/format';
import { EntryBlock } from '../entry/EntryBlock';
import { StartFrom } from '../entry/StartFrom';
import { StaticSections } from '../components/LaunchSection';
import panel from '../components/launch.module.css';
import { useLaunch } from '../LaunchContext';
import styles from '../LaunchPage.module.css';
import { axesOf, buildSpec, datasetChanged } from '../model';
import { MobileLaunchBar } from '../review/MobileLaunchBar';
import { ReviewPane } from '../review/ReviewPane';
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

interface Props {
  step: WizardStepId;
  next: WizardStepId | null;
  prev: WizardStepId | null;
  onGo: (step: WizardStepId) => void;
  onCancel: () => void;
}

/** Customize: the six-step wizard. One step on screen at a time over a progress rail; the review stays in view. */
export function LaunchWizard({ step, next, prev, onGo, onCancel }: Props) {
  const { doc, ctx, review, flags, sectionSummary, sectionState } = useLaunch();
  const wide = useMediaQuery('(min-width: 1200px)');
  const swept = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length,
    [doc, ctx.evaluatorPanel],
  );
  const hasEnv = doc.environmentIds.length > 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const announce = useMemo(() => {
    const index = WIZARD_STEPS.findIndex((s) => s.id === step) + 1;
    return `Step ${index} of ${WIZARD_STEPS.length}: ${stepLabel(step)}`;
  }, [step]);

  // A step change: the rail comes to the top of the view and the heading takes focus.
  useEffect(() => {
    rail.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  // The Raw JSON card is always open in the wizard; its editor registers its field while open.
  const { setOpen } = sectionState;
  useEffect(() => {
    if (step === 'review') setOpen('raw', true);
  }, [step, setOpen]);

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
      changes =
        (datasetChanged(doc) ? 1 : 0) + (doc.priority ? 1 : 0) + (doc.versioningText.trim() ? 1 : 0);
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
            <div className={panel.panel}>
              <StartFrom />
            </div>
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
          <ReviewPane onCancel={onCancel} />
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
        <StepPanel key={step} ref={heading} stepId={step} title={title}>
          {!hasEnv ? (
            <p className={styles.hint}>Pick an environment first (step 1) to configure this step.</p>
          ) : loading ? null : (
            <StaticSections untitled={step === 'models' ? ['models'] : step === 'settings' ? ['settings'] : ['evaluation']}>
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

  const showAside = wide && step !== 'review';
  return (
    <div className={`${styles.layout} ${showAside ? '' : styles.layoutSingle}`}>
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
        {body}
        <StepNav step={step} next={next} prev={prev} onGo={onGo} />
        {wide || step === 'review' ? null : <ReviewPane onCancel={onCancel} hideActions />}
        {wide || step === 'review' ? null : <MobileLaunchBar onCancel={onCancel} />}
      </div>
      {showAside ? (
        <div className={styles.aside}>
          <ReviewPane onCancel={onCancel} />
        </div>
      ) : null}
    </div>
  );
}
