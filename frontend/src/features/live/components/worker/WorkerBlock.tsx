import type { ReactNode } from 'react';
import { Card, SectionBoundary, SectionHeader } from '@/ui';
import styles from '../../worker.module.css';

export function WorkerBlock({
  name,
  title,
  aside,
  children,
}: {
  name: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={name === 'problems' ? 'problems' : undefined} data-live-block={`worker-${name}`}>
      <SectionBoundary name={title}>
        <Card>
          <SectionHeader title={title} aside={aside} />
          <div className={styles.stack}>{children}</div>
        </Card>
      </SectionBoundary>
    </section>
  );
}
