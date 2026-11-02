import type { ReactNode } from 'react';
import styles from './launch.module.css';

export interface CalloutProps {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  /** Announced when it appears (errors / blocking notes). */
  live?: boolean;
  children?: ReactNode;
  className?: string;
}

/** A bordered note inside the launch form (same recipe as the environment page callouts). */
export function Callout({ tone = 'info', title, live, children, className }: CalloutProps) {
  return (
    <div
      className={[styles.callout, className].filter(Boolean).join(' ')}
      data-tone={tone}
      role={live ? (tone === 'error' ? 'alert' : 'status') : 'note'}
    >
      {title ? <div className={styles.calloutTitle}>{title}</div> : null}
      {children}
    </div>
  );
}
