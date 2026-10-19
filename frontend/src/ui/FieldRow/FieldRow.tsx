import { useId, type ReactNode } from 'react';
import { textDirAttrs } from '@/lib/text';
import styles from './FieldRow.module.css';

export interface FieldRowProps {
  /** The field name (INPUT, EXPECTED). */
  label: ReactNode;
  /** Actions at the end of the row (copy, link). */
  actions?: ReactNode;
  /** Row direction; `auto` (default) follows `text` when given. */
  dir?: 'ltr' | 'rtl' | 'auto';
  /** Text the direction is detected from when `dir` is `auto`. */
  text?: unknown;
  /** `prose` caps the body at a reading measure (76ch); `full` for code and tables. */
  measure?: 'prose' | 'full';
  /** `success` or `danger` draws the 2px verdict rail at the inline start. */
  rail?: 'success' | 'danger' | 'info';
  /**
   * `auto` (default): the row takes the content direction (an Arabic input mirrors the row). `start`: the row is always
   * left to right, so the label never moves; only the value block carries the text direction (round 3 P5).
   */
  labelAnchor?: 'auto' | 'start';
  /** Tooltip of the label; defaults to the label text. A long key wraps in its column, it is never cut (round 7, D2). */
  labelTitle?: string;
  /** `upper` (default) is the eyebrow style; `sentence` keeps the key's case (round 5 R3 fact keys). */
  labelCase?: 'upper' | 'sentence';
  className?: string;
  children: ReactNode;
}

/**
 * Field row recipe: label and body are adjacent at the inline start of the row, actions at its end. The row
 * itself takes the content direction, so an Arabic input mirrors the whole row (label at the right, next to
 * the text) instead of leaving the text a table's width away from its label. Under 640px of container width
 * the label sits above the body.
 */
export function FieldRow({
  label,
  actions,
  dir = 'auto',
  text,
  measure = 'prose',
  rail,
  labelAnchor = 'auto',
  labelTitle,
  labelCase = 'upper',
  className,
  children,
}: FieldRowProps) {
  const id = useId();
  const attrs = dir === 'auto' ? (text !== undefined ? textDirAttrs(text) : {}) : { dir };
  const start = labelAnchor === 'start';
  return (
    <div className={[styles.host, className].filter(Boolean).join(' ')}>
      <div
        role="group"
        aria-labelledby={id}
        className={styles.row}
        data-measure={measure}
        data-rail={rail}
        data-anchor={start ? 'start' : undefined}
        {...(start ? { dir: 'ltr' as const } : attrs)}
      >
        <div
          id={id}
          className={styles.label}
          data-case={labelCase === 'sentence' ? 'sentence' : undefined}
          title={labelTitle ?? (typeof label === 'string' ? label : undefined)}
        >
          {label}
        </div>
        <div className={styles.body}>
          {start ? (
            <div className={styles.value} data-measure={measure} {...attrs}>
              {children}
            </div>
          ) : (
            children
          )}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
