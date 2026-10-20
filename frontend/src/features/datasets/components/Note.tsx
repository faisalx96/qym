import type { ReactNode } from 'react';
import { Icon } from '@/ui';
import styles from './Note.module.css';

export interface NoteProps {
  tone: 'warning' | 'info' | 'danger';
  icon?: 'info' | 'warning' | 'lock';
  title?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

/** The dataset note recipe (decision A-16): a 3px start rail on a tinted block, an icon, a title and lines. */
export function Note({ tone, icon, title, children, ...rest }: NoteProps) {
  return (
    <div className={styles.note} data-tone={tone} role="note" {...rest}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warning')} size={14} />
      <div className={styles.body}>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
