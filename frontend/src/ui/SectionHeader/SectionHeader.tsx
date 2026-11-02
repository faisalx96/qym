import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './SectionHeader.module.css';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** 'xl' (default) = section head, 18px: the one section scale of every page; 'lg' = a panel head, 15px. */
  level?: 'lg' | 'xl';
  id?: string;
}

/** Sentence-case section title + muted description (DESIGN_LANGUAGE §1). */
export function SectionHeader({ title, description, aside, level = 'xl', id }: SectionHeaderProps) {
  return (
    <div className={styles.head} data-level={level}>
      <div className={styles.text}>
        <Text variant={level} id={id} className={styles.title}>
          {title}
        </Text>
        {description ? (
          <Text
            variant={level === 'xl' ? 'base' : 'sm'}
            tone="muted"
            as="p"
            className={styles.description}
            truncate
          >
            {description}
          </Text>
        ) : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}
