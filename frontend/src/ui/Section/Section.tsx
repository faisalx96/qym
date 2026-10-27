import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { SectionHeader } from '../SectionHeader';
import styles from './Section.module.css';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Controls on the header's end side (a button, a toggle, a status line). */
  actions?: ReactNode;
  /** 'xl' (default) = a page section; 'lg' = a panel section inside a page area. */
  level?: 'lg' | 'xl';
  /** Anchor id of the section; the title gets `${id}-title` (or `titleId`). */
  id?: string;
  titleId?: string;
  /** Class of the body that holds the children. */
  bodyClassName?: string;
  children?: ReactNode;
}

/**
 * Section (DESIGN_LANGUAGE §3 "Section"): a titled block of a page. Sections that follow each other are divided by one
 * hairline with the same space above and below it; the first section of a page area has no line, so nothing doubles
 * the line under the tabs or the page header. Parents stack sections with no gap of their own.
 */
export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  { title, description, actions, level = 'xl', id, titleId, className, bodyClassName, children, ...rest },
  ref,
) {
  const headingId = titleId ?? (id ? `${id}-title` : undefined);
  return (
    <section
      ref={ref}
      id={id}
      className={[styles.section, className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      data-section=""
      {...rest}
    >
      <SectionHeader id={headingId} level={level} title={title} description={description} aside={actions} />
      <div className={[styles.body, bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </section>
  );
});

/** For a section that renders its own markup (the run Items section): the class that gives it the divider rhythm. */
export const sectionClassName = styles.section;
