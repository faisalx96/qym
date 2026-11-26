import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './SectionHeader.module.css';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** 'xl' (default) = section head, 18px: the one section scale of every page; 'lg' = a panel head, 15px. */
  level?: 'lg' | 'xl';
  /** Semantic heading level, independent of the visual title scale. */
  as?: 'h2' | 'h3';
  id?: string;
  /** A count Tag right after the title (B-27: '2 people', '1 in the last hour'). */
  count?: ReactNode;
  /**
   * The description is read in full: it wraps instead of ending in an ellipsis, and the controls drop under the text
   * when the header's own width leaves no room for both (the text keeps `--section-text-min`). Default off: one line.
   */
  wrap?: boolean;
}

/** Sentence-case section title + muted description (DESIGN_LANGUAGE §1). */
export function SectionHeader({
  title,
  description,
  aside,
  level = 'xl',
  as,
  id,
  count,
  wrap = false,
}: SectionHeaderProps) {
  const heading = (
    <Text variant={level} as={as} id={id} className={styles.title}>
      {title}
    </Text>
  );
  return (
    <div className={styles.head} data-level={level} data-wrap={wrap ? '' : undefined}>
      <div className={styles.text}>
        {count ? (
          <div className={styles.titleRow}>
            {heading}
            {count}
          </div>
        ) : (
          heading
        )}
        {description ? (
          <Text
            variant={level === 'xl' ? 'base' : 'sm'}
            tone="muted"
            as="p"
            className={styles.description}
            truncate={!wrap}
          >
            {description}
          </Text>
        ) : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}
