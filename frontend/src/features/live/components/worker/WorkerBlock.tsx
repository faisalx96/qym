import type { ReactNode } from 'react';
import { Card, Pagination, SectionBoundary, SectionHeader } from '@/ui';
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

/** The server can return a bounded jobs list without its complete total. */
export function WorkerPagination({
  total,
  page,
  pageSize,
  noun,
  hasMore = false,
  totalIsLowerBound = hasMore,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  noun: string;
  hasMore?: boolean;
  totalIsLowerBound?: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className={styles.pagination}>
      <span aria-live="polite">
        Showing {total ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, total)} of{' '}
        {totalIsLowerBound ? 'at least ' : ''}
        {total} {noun}
      </span>
      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        pageCount={Math.max(1, Math.ceil(total / pageSize)) + Number(hasMore)}
        noun={noun}
        showSummary={false}
        onPageChange={onPageChange}
      />
    </div>
  );
}
