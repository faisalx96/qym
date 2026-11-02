import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral' | 'accent' | 'meta';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
  dot?: boolean;
  /** A non-colour cue before the label (e.g. a check on Approved). Decorative: the label carries the meaning. */
  glyph?: ReactNode;
  children: ReactNode;
}

/** Status / outcome pill: outlined, 20px, sans 10px/650 (DESIGN_LANGUAGE §3). */
export function Badge({ tone, dot, glyph, className, children, ...rest }: BadgeProps) {
  return (
    <span className={[styles.badge, className].filter(Boolean).join(' ')} data-tone={tone} {...rest}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {glyph ? (
        <span className={styles.glyph} aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}
