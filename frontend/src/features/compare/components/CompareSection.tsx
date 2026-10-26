/** One compare report section (round 8 recipe): title + one description line + the controls of that section, then the body. */
import type { ReactNode } from 'react';
import { Text } from '@/ui';
import styles from './CompareSection.module.css';

export interface CompareSectionProps {
  /** Anchor id; the title gets `${id}-title`. */
  id: string;
  /** `data-part` of the section (`section-runs`, ...). */
  part: string;
  title: ReactNode;
  description?: ReactNode;
  /** The controls that change this section (baseline select, metric tabs, chip bar). */
  aside?: ReactNode;
  /** Render nothing (steps without spans, empty root cause). */
  hidden?: boolean;
  children?: ReactNode;
}

export function CompareSection({ id, part, title, description, aside, hidden, children }: CompareSectionProps) {
  if (hidden) return null;
  const titleId = `${id}-title`;
  return (
    <section id={id} className={styles.section} aria-labelledby={titleId} data-report-section={id} data-part={part}>
      <div className={styles.head} data-part="section-head">
        <div className={styles.headText}>
          <Text variant="xl" as="h2" id={titleId} className={styles.title}>
            {title}
          </Text>
          {description ? (
            <Text variant="sm" tone="muted" as="p" className={styles.desc}>
              {description}
            </Text>
          ) : null}
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
