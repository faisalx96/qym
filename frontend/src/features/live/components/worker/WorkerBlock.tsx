import type { ReactNode } from 'react';
import { Card, SectionBoundary, SectionHeader } from '@/ui';
import styles from '../../worker.module.css';

export function WorkerBlock({
  name,
  title,
  aside,
  count,
  table,
  footer,
  children,
}: {
  name: string;
  title: string;
  aside?: ReactNode;
  /** A count Tag right after the title (B-27). */
  count?: ReactNode;
  /** The block is one table: a flush Card with the head in its header slot (D-09). */
  table?: boolean;
  /** The Card footer (E-12). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const head = <SectionHeader title={title} aside={aside} count={count} />;
  return (
    <section id={name === 'problems' ? 'problems' : undefined} data-live-block={`worker-${name}`}>
      <SectionBoundary name={title}>
        {table ? (
          <Card flush header={head} footer={footer}>
            {children}
          </Card>
        ) : (
          <Card footer={footer}>
            {head}
            <div className={styles.stack}>{children}</div>
          </Card>
        )}
      </SectionBoundary>
    </section>
  );
}
