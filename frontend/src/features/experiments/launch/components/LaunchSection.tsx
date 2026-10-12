import type { ReactNode } from 'react';
import { Icon, Tag } from '@/ui';
import { plural } from '../../lib/format';
import { sectionBodyId, sectionHeadingId, SECTION_TITLES, useLaunch, type SectionId } from '../LaunchContext';
import { SectionProblems } from './SectionProblems';
import styles from './launch.module.css';

export interface LaunchSectionProps {
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
  children,
}: LaunchSectionProps) {
  const { sectionState, sectionSummary } = useLaunch();
  const open = sectionState.open[id];
  const { changes, problems } = sectionSummary(id);
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
          <span className={styles.chevron}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          </span>
          <span className={styles.toggleTitle}>{title}</span>
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
          {description ? <span className={styles.toggleDesc}>{description}</span> : null}
        </button>
      </h3>
      {open ? (
        <div id={sectionBodyId(id)} className={styles.sectionBody}>
          <SectionProblems id={id} />
          {children}
        </div>
      ) : null}
    </section>
  );
}
