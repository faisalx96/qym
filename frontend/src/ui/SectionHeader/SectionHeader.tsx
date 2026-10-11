import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './SectionHeader.module.css';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** 'lg' = analytical section (15px); 'xl' = run-page section head (18px). */
  level?: 'lg' | 'xl';
  id?: string;
}

/** Sentence-case section title + muted description (DESIGN_LANGUAGE §1). */
export function SectionHeader({ title, description, aside, level = 'lg', id }: SectionHeaderProps) {
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
