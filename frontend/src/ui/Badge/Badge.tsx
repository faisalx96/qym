import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

/** Status / outcome pill: outlined, 20px, sans 10px/650 (DESIGN_LANGUAGE §3). */
export function Badge({ tone, dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={[styles.badge, className].filter(Boolean).join(' ')} data-tone={tone} {...rest}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
