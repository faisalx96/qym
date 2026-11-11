import { forwardRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/ui';
import type { WizardStepDef, WizardStepId } from '../wizard/steps';
import styles from './launchBar.module.css';

/**
 * The one bottom bar (round 9, point 3; round 10): the same chrome on the home view and on every step. It is the next
 * sibling of the content (the page gap above it) and sticky at the bottom of the scroller, so it rides at the viewport
 * bottom only while the content is taller than the viewport (round 10, point 4). `--bar-action-h`, `--bg-elevated` with
 * `--border-default`; every button is 24 px.
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
  /** Why the locked primary cannot run yet: the reason box on hover (A-22). */
  reason?: string;
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
  /** The last step's action (launch: "Launch N runs"; editor: "Publish vN"). */
  primary: BarPrimary;
  /** `launch` or `publish`: what the primary slot does on the last step. */
  action?: 'launch' | 'publish';
  /** The status slot: the run count (or change count) and the first problem, or Ready. */
  status: ReactNode;
}

/**
 * The five slots of every wizard step (round 10, point 1): Skip to review and Cancel at the far left, the status in the
 * centre, Back and the primary slot at the far right. The primary slot is "Continue" on every step but the last and the
 * launch (or publish) on the last; it keeps one minimum width, so Back never moves. There is no launch on earlier steps.
 */
export function StepsBar({
  steps,
  step,
  onBack,
  onGo,
  onCancel,
  primary,
  action = 'launch',
  status,
}: StepsBarProps) {
  const index = steps.findIndex((s) => s.id === step);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
  const last = steps[steps.length - 1];
  return (
    <LaunchBar>
      <div className={styles.start}>
        <BarButton
          part="bar-skip"
          variant="neutral"
          isDisabled={!next}
          aria-label={action === 'publish' ? 'Skip to review and publish' : 'Skip to review and launch'}
          onPress={() => last && onGo(last.id)}
        >
          Skip<span className={styles.long}> to review</span>
        </BarButton>
        <BarButton part="bar-cancel" variant="neutral" onPress={onCancel}>
          Cancel
        </BarButton>
      </div>
      <div className={styles.status} data-part="bar-status">
        {status}
      </div>
      <div className={styles.end}>
        <BarButton
          part="bar-back"
          variant="neutral"
          aria-label={
            prev
              ? `Back to ${prev.label.toLowerCase()}`
              : action === 'publish'
                ? 'Back to the environment'
                : 'Back to the start'
          }
          onPress={() => (prev ? onGo(prev.id) : onBack())}
        >
          Back
        </BarButton>
        <BarButton
          part="bar-continue"
          data-action={next ? 'continue' : action}
          variant={next ? 'neutral' : 'primary'}
          className={styles.primary}
          loading={next ? undefined : primary.loading}
          isDisabled={next ? undefined : primary.disabled}
          disabledReason={next ? undefined : primary.reason}
          aria-label={next ? `Continue to ${next.label.toLowerCase()}` : undefined}
          onPress={() => (next ? onGo(next.id) : primary.onPress())}
        >
          {next ? 'Continue' : primary.label}
        </BarButton>
      </div>
    </LaunchBar>
  );
}
