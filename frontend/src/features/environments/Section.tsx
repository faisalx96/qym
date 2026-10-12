import type { ReactNode } from 'react';
import styles from './EnvironmentPage.module.css';

export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={styles.section} aria-labelledby={headingId} data-section={id}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle} id={headingId}>
            {title}
          </h2>
          {description ? <p className={styles.sectionDesc}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
