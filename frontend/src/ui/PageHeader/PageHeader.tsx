import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
  tabs?: ReactNode;
  /** Identicon / icon before the title. */
  leading?: ReactNode;
}

/** Page anatomy: title → description → meta line → tabs (DESIGN_LANGUAGE §4). */
export function PageHeader({ title, description, meta, actions, tabs, leading }: PageHeaderProps) {
  return (
    <header className={styles.header} data-page-header>
      <div className={styles.row}>
        <div className={styles.titleBlock}>
          {leading ? <div className={styles.leading}>{leading}</div> : null}
          <div className={styles.titleText}>
            <Text variant="title" className={styles.title}>
              {title}
            </Text>
            {description ? (
              <Text variant="base" tone="muted" className={styles.description} truncate>
                {description}
              </Text>
            ) : null}
            {meta && meta.length ? (
              <div className={styles.meta}>
                {meta.map((item, i) => (
                  <span key={i} className={styles.metaItem}>
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {tabs ? <div className={styles.tabs}>{tabs}</div> : null}
    </header>
  );
}
