import { forwardRef, type ReactNode } from 'react';
import { Text } from '@/ui';
import styles from './wizard.module.css';

export const stepHeadingId = (stepId: string) => `launch-step-${stepId}`;

/**
 * One wizard step. Keyed by the step id by the caller, so each step mounts fresh and plays the 180ms
 * enter (opacity + an 8px rise). The heading is the focus target after a step change.
 */
export const StepPanel = forwardRef<
  HTMLHeadingElement,
  {
    stepId: string;
    title: string;
    description?: string;
    children: ReactNode;
  }
>(function StepPanel({ stepId, title, description, children }, headingRef) {
  return (
    <section className={styles.panel} aria-labelledby={stepHeadingId(stepId)} data-step={stepId}>
      <header className={styles.panelHead}>
        <h2 ref={headingRef} id={stepHeadingId(stepId)} tabIndex={-1} className={styles.panelTitle}>
          {title}
        </h2>
        {description ? (
          <Text variant="base" tone="muted">
            {description}
          </Text>
        ) : null}
      </header>
      {children}
    </section>
  );
});
