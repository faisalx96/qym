import { useRef, type ReactNode } from 'react';
import { useInView } from '@/lib/useInView';
import { Text } from '../Text';
import styles from './ReportSection.module.css';

export interface ReportSectionProps {
  /** Anchor id; the title gets `${id}-title`. */
  id: string;
  /** `data-part` of the section (compare: `section-runs`, ...); defaults to `section`. */
  part?: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** "over 112 of 240 items": shown beside the aside while a scope is active. */
  scopeNote?: string;
  /** Mount the body when the section nears the viewport (once; never unmounted afterwards). */
  lazy?: boolean;
  /** Reserved height (px) of a lazy body that has not mounted yet. */
  minHeight?: number;
  /** Render nothing (empty Root cause / Reviews). */
  hidden?: boolean;
  /** Intersection root margin for `lazy`. */
  rootMargin?: string;
  className?: string;
  children?: ReactNode;
}

/** One full-width report section: a framed panel (DESIGN_LANGUAGE §3 "Report section"): head inside, container-query body of inset cards. */
export function ReportSection({
  id,
  part = 'section',
  title,
  description,
  aside,
  scopeNote,
  lazy = false,
  minHeight = 160,
  hidden = false,
  rootMargin,
  className,
  children,
}: ReportSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { rootMargin, disabled: !lazy || hidden });
  if (hidden) return null;
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      ref={ref}
      className={[styles.section, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      data-report-section={id}
      data-part={part}
      data-mounted={inView ? '' : undefined}
    >
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
        {scopeNote || aside ? (
          <div className={styles.aside}>
            {scopeNote ? (
              <Text variant="sm" tone="muted" data-testid="scope-note">
                {scopeNote}
              </Text>
            ) : null}
            {aside}
          </div>
        ) : null}
      </div>
      <div
        className={styles.body}
        style={inView ? undefined : { minHeight }}
        data-arrive={lazy && inView ? '' : undefined}
      >
        {inView ? children : null}
      </div>
    </section>
  );
}
