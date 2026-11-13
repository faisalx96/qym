import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import styles from './Timeline.module.css';

export type TimelineTone = 'accent' | 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export interface TimelineItem {
  key: string;
  /** The time of the event, already formatted (shown before the rail). Leave it out for a timeline with no time column. */
  time?: ReactNode;
  /** The full date for the tooltip of the time. */
  timeTitle?: string;
  /** ISO date for the `<time>` element. */
  dateTime?: string;
  /** The glyph in the mark on the rail (default: a small dot). */
  icon?: IconName;
  /** The colour of the mark. `neutral` (default) is the quiet mark. */
  tone?: TimelineTone;
  /** What happened, or the name of the step. */
  title: ReactNode;
  /** A quiet second part after the title on the same line: the person, a count. */
  meta?: ReactNode;
  /** A second line under the title. */
  detail?: ReactNode;
  /** Controls at the end of the row (a row menu, an action tile). */
  actions?: ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  'aria-label'?: string;
  /** With `onSelect`: the selected row. */
  activeKey?: string | null;
  /** Makes each row selectable (a list of versions, for example). */
  onSelect?: (key: string) => void;
  /** Width of the time column in px (default 112). Ignored when no item has a time. */
  timeWidth?: number;
  className?: string;
}

/**
 * Timeline (cv5 H5): the standard element for a dated list of events about one entity, or for a list of versions in
 * order. Time, then a mark on a rail, then the event and its quiet second part. First used by the dataset Change log
 * (cv4 E10); the owner asked for it as a standard element (2026-11-13).
 */
export function Timeline({
  items,
  activeKey,
  onSelect,
  timeWidth = 112,
  className,
  'aria-label': ariaLabel,
}: TimelineProps) {
  const hasTime = items.some((i) => i.time != null);
  return (
    <ol
      className={[styles.timeline, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      data-timeline=""
      data-has-time={hasTime ? '' : undefined}
      data-selectable={onSelect ? '' : undefined}
      style={hasTime ? ({ '--timeline-time': `${timeWidth}px` } as CSSProperties) : undefined}
    >
      {items.map((it) => {
        const active = onSelect != null && it.key === activeKey;
        const body = (
          <>
            <span className={styles.title}>{it.title}</span>
            {it.meta != null ? <span className={styles.meta}>{it.meta}</span> : null}
            {it.detail != null ? <span className={styles.detail}>{it.detail}</span> : null}
          </>
        );
        return (
          <li key={it.key} className={styles.event} data-active={active ? '' : undefined} data-key={it.key}>
            {hasTime ? (
              <time className={styles.when} dateTime={it.dateTime} title={it.timeTitle}>
                {it.time}
              </time>
            ) : null}
            <span className={styles.rail} aria-hidden="true">
              <span
                className={styles.mark}
                data-tone={it.tone ?? 'neutral'}
                data-dot={it.icon ? undefined : ''}
              >
                {it.icon ? <Icon name={it.icon} size={12} /> : null}
              </span>
            </span>
            {onSelect ? (
              <button
                type="button"
                className={styles.what}
                data-row-primary=""
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(it.key)}
              >
                {body}
              </button>
            ) : (
              <span className={styles.what}>{body}</span>
            )}
            {it.actions != null ? <span className={styles.actions}>{it.actions}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
