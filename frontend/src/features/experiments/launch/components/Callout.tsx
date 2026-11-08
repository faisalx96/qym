import type { ReactNode } from 'react';
import { Icon } from '@/ui';
import styles from './launch.module.css';

export interface CalloutProps {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  /** Announced when it appears (errors / blocking notes). */
  live?: boolean;
  children?: ReactNode;
  className?: string;
}

/** A note inside the launch form in the InlineNotice recipe (C-43): tone rail, glyph and wash; the title leads the line. */
export function Callout({ tone = 'info', title, live, children, className }: CalloutProps) {
  return (
    <div
      className={[styles.callout, className].filter(Boolean).join(' ')}
      data-tone={tone === 'error' ? 'danger' : tone}
      role={live ? (tone === 'error' ? 'alert' : 'status') : 'note'}
    >
      <Icon
        name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'warning'}
        size={14}
        className={styles.calloutIcon}
      />
      <div className={styles.calloutText}>
        {title ? <span className={styles.calloutTitle}>{title}</span> : null}
        {title && children ? ' ' : null}
        {children}
      </div>
    </div>
  );
}
