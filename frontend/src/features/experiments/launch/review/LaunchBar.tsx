import { forwardRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/ui';
import type { WizardStepDef, WizardStepId } from '../wizard/steps';
import styles from './launchBar.module.css';

/**
 * The one bottom bar (round 9, point 3): the same chrome on the home view and on every step. Sticky at the bottom of the
 * scroller, `--bar-action-h`, `--bg-elevated` with `--border-default`; every button is 24 px. The slots are fixed
 * (Back, Skip to review, Continue, status, Cancel, Launch): a slot that does not apply is disabled, never removed.
 */
export function LaunchBar({ children, mode = 'steps' }: { children: ReactNode; mode?: 'steps' | 'home' }) {
  return (
    <div className={styles.bar} data-part="launch-bar" data-bar={mode} role="region" aria-label="Launch">
      {children}
    </div>
  );
}

type BarButtonProps = Omit<ButtonProps, 'size'> & { part: string };

/** A bar button on the 24 px control: a disabled one is also `aria-disabled` and leaves the tab order. */
export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { part, isDisabled, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      size="sm"
      data-part={part}
      isDisabled={isDisabled}
      aria-disabled={isDisabled ? true : undefined}
      {...rest}
    />
  );
});

export interface BarPrimary {
  label: string;
  disabled: boolean;
  loading?: boolean;
  onPress: () => void;
}

export interface StepsBarProps {
  steps: readonly WizardStepDef[];
  step: WizardStepId;
  /** Back from the first step: the start view (launch) or the environment page (editor). */
  onBack: () => void;
  onGo: (step: WizardStepId) => void;
  onCancel: () => void;
  primary: BarPrimary;
  /** The status slot: the run count (or change count) and the first problem, or Ready. */
  status: ReactNode;
}

/** The six slots of every wizard step. Labels never change; the destination is the button's title and aria-label. */
export function StepsBar({ steps, step, onBack, onGo, onCancel, primary, status }: StepsBarProps) {
  const index = steps.findIndex((s) => s.id === step);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
  const last = steps[steps.length - 1];
  const onReview = step === last?.id;
  const skipTitle = `Skip to ${last?.label.toLowerCase() ?? 'review'}`;
  return (
    <LaunchBar>
      <div className={styles.nav}>
        <BarButton
          part="bar-back"
          variant="neutral"
          aria-label={prev ? `Back to ${prev.label.toLowerCase()}` : 'Back to the start'}
          onPress={() => (prev ? onGo(prev.id) : onBack())}
        >
          Back
        </BarButton>
        <BarButton
          part="bar-skip"
          variant="neutral"
          isDisabled={onReview}
          aria-label={skipTitle}
          onPress={() => last && onGo(last.id)}
        >
          Skip<span className={styles.long}> to review</span>
        </BarButton>
        <BarButton
          part="bar-continue"
          variant="neutral"
          isDisabled={!next}
          aria-label={next ? `Continue to ${next.label.toLowerCase()}` : 'Continue'}
          onPress={() => next && onGo(next.id)}
        >
          Continue
        </BarButton>
      </div>
      <div className={styles.status} data-part="bar-status">
        {status}
      </div>
      <div className={styles.end}>
        <BarButton part="bar-cancel" variant="ghost" onPress={onCancel}>
          Cancel
        </BarButton>
        <BarButton
          part="bar-launch"
          variant="primary"
          className={styles.launch}
          loading={primary.loading}
          isDisabled={primary.disabled}
          onPress={primary.onPress}
        >
          {primary.label}
        </BarButton>
      </div>
    </LaunchBar>
  );
}
