import { useRef, type ReactNode } from 'react';
import { useInView } from '@/lib/useInView';
import { SectionHeader } from '../SectionHeader';
import { Text } from '../Text';
import styles from './ReportSection.module.css';

export interface ReportSectionProps {
  /** Anchor id; the title gets `${id}-title`. */
  id: string;
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

/** One full-width report section: run section header (xl) over a container-query body (DESIGN_LANGUAGE §3). */
export function ReportSection({
  id,
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
      data-mounted={inView ? '' : undefined}
    >
      <SectionHeader
        level="xl"
        id={titleId}
        title={title}
        description={description}
        aside={
          scopeNote || aside ? (
            <>
              {scopeNote ? (
                <Text variant="sm" tone="muted" data-testid="scope-note">
                  {scopeNote}
                </Text>
              ) : null}
              {aside}
            </>
          ) : undefined
        }
      />
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
