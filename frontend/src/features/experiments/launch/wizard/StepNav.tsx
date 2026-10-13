import { Button } from '@/ui';
import { stepLabel, type WizardStepId } from './steps';
import styles from './wizard.module.css';

/** Back / Skip to review / Continue to <next step>. The review step has no next action (Launch is in the review). */
export function StepNav({
  step,
  next,
  prev,
  onGo,
}: {
  step: WizardStepId;
  next: WizardStepId | null;
  prev: WizardStepId | null;
  onGo: (step: WizardStepId) => void;
}) {
  const optional = step === 'models' || step === 'settings' || step === 'evaluation';
  return (
    <nav className={styles.nav} aria-label="Step navigation">
      <div>
        {prev ? (
          <Button variant="neutral" onPress={() => onGo(prev)}>
            Back
          </Button>
        ) : null}
      </div>
      <div className={styles.navNext}>
        {optional ? (
          <Button variant="neutral" aria-label="Skip to review" onPress={() => onGo('review')}>
            Skip<span className={styles.long}> to review</span>
          </Button>
        ) : null}
        {next ? (
          <Button
            variant="accent"
            aria-label={`Continue to ${stepLabel(next).toLowerCase()}`}
            onPress={() => onGo(next)}
          >
            Continue<span className={styles.long}>{` to ${stepLabel(next).toLowerCase()}`}</span>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
