import { createContext, useContext, type ReactNode } from 'react';
import { Collapse, Icon, Tag } from '@/ui';
import { plural } from '../../lib/format';
import { sectionBodyId, sectionHeadingId, SECTION_TITLES, useLaunch, type SectionId } from '../LaunchContext';
import { SectionProblems } from './SectionProblems';
import styles from './launch.module.css';

/**
 * `static` renders the frame as a plain heading with the body always shown (the wizard steps);
 * `collapsible` (the default, the default-preset editor page) is the disclosure.
 */
export type LaunchSectionVariant = 'collapsible' | 'static';

interface StaticFrame {
  /** Sections whose title the step heading already shows (rendered without their own title). */
  untitled: readonly SectionId[];
}

const StaticFrameCtx = createContext<StaticFrame | null>(null);

/** Wraps sections of a wizard step: they render `variant="static"`. */
export function StaticSections({
  untitled = [],
  children,
}: {
  untitled?: readonly SectionId[];
  children: ReactNode;
}) {
  return <StaticFrameCtx.Provider value={{ untitled }}>{children}</StaticFrameCtx.Provider>;
}

export interface LaunchSectionProps {
  /** Overrides the frame set by `StaticSections`. */
  variant?: LaunchSectionVariant;
  id: SectionId;
  /** Defaults to the standard title of the section. */
  title?: string;
  /** One muted line under the title. */
  description?: string;
  /** Replaces the default "N changed" badge (e.g. the run count of Sweeps). */
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * The collapsible frame of every section: a disclosure heading with a real count badge
 * (`sectionSummary(id).changes`) and a red problem count, the problems summary at the top of the
 * body, open state kept in the launch context (so a clicked problem can open it) and an anchor id
 * for the outline.
 */
export function LaunchSection({
  id,
  title = SECTION_TITLES[id],
  description,
  badge,
  variant,
  children,
}: LaunchSectionProps) {
  const { sectionState, sectionSummary } = useLaunch();
  const frame = useContext(StaticFrameCtx);
  const open = sectionState.open[id];
  const { changes, problems } = sectionSummary(id);
  const badges = (
    <span className={styles.badges}>
      {badge ?? (
        <Tag kind="count" tone={changes ? 'info' : undefined}>
          {changes ? `${changes} changed` : 'no changes'}
        </Tag>
      )}
      {problems.length ? (
        <Tag kind="count" tone="danger">
          {plural(problems.length, 'problem')}
        </Tag>
      ) : null}
    </span>
  );
  if ((variant ?? (frame ? 'static' : 'collapsible')) === 'static') {
    const titled = !frame?.untitled.includes(id);
    return (
      <section
        id={`launch-anchor-${id}`}
        className={styles.staticSection}
        aria-labelledby={titled ? sectionHeadingId(id) : undefined}
        aria-label={titled ? undefined : title}
      >
        <div className={styles.staticHead}>
          {titled ? (
            <h3 id={sectionHeadingId(id)} className={styles.toggleTitle}>
              {title}
            </h3>
          ) : null}
          {badges}
          {description ? <p className={styles.staticDesc}>{description}</p> : null}
        </div>
        <div id={sectionBodyId(id)} className={styles.staticBody}>
          <SectionProblems id={id} />
          {children}
        </div>
      </section>
    );
  }
  return (
    <section id={`launch-anchor-${id}`} className={styles.section} aria-labelledby={sectionHeadingId(id)}>
      <h3 className={styles.sectionHead}>
        <button
          type="button"
          id={sectionHeadingId(id)}
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={sectionBodyId(id)}
          onClick={() => sectionState.toggle(id)}
        >
          <span className={styles.chevron} data-open={open}>
            <Icon name="chevron-right" />
          </span>
          <span className={styles.toggleTitle}>{title}</span>
          {badges}
          {description ? <span className={styles.toggleDesc}>{description}</span> : null}
        </button>
      </h3>
      <Collapse open={open} id={sectionBodyId(id)}>
        <div className={styles.sectionBody}>
          <SectionProblems id={id} />
          {children}
        </div>
      </Collapse>
    </section>
  );
}
