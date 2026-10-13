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
    /** Receives the element beside the heading (the badges of the step's section are portalled into it). */
    onBadgeSlot?: (el: HTMLElement | null) => void;
    children: ReactNode;
  }
>(function StepPanel({ stepId, title, description, onBadgeSlot, children }, headingRef) {
  return (
    <div className={styles.panel} data-step={stepId}>
      <header className={styles.panelHead}>
        <div className={styles.titleRow}>
          <h2 ref={headingRef} id={stepHeadingId(stepId)} tabIndex={-1} className={styles.panelTitle}>
            {title}
          </h2>
          {onBadgeSlot ? <span ref={onBadgeSlot} className={styles.titleBadges} /> : null}
        </div>
        {description ? (
          <Text variant="base" tone="muted">
            {description}
          </Text>
        ) : null}
      </header>
      {children}
    </div>
  );
});
