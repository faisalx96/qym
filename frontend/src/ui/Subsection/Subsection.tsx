import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './Subsection.module.css';

export interface SubsectionProps {
  title: ReactNode;
  /** One muted line after the title, on the same line while it fits. */
  description?: ReactNode;
  /** Controls at the end of the head (a toggle, a count). */
  aside?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A group inside a report section (round 10, as in the first qym run page): a 3px accent bar, the title and one
 * muted line on the same line, then the body. Two subsections in a row are 20px apart. Use it for the named parts
 * of a section (Repeat performance, Response time, Inside the traces), never as a card title.
 */
export function Subsection({ title, description, aside, id, className, children }: SubsectionProps) {
  return (
    <section className={[styles.sub, className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <div className={styles.head} data-part="subsection-head">
        <Text variant="md" as="h3" id={id} weight={650} className={styles.title}>
          {title}
        </Text>
        {description ? (
          <Text variant="sm" tone="muted" as="p" className={styles.desc}>
            {description}
          </Text>
        ) : null}
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
