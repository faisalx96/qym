import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Tag.module.css';

export type TagKind = 'role' | 'accent' | 'count' | 'data' | 'version';
export type TagTone = 'success' | 'info' | 'warning' | 'danger';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: TagKind;
  tone?: TagTone;
  children: ReactNode;
}

/** Role/metadata tag: borderless, --control-radius, tinted fill; mono for role/count/data/version. */
export function Tag({ kind, tone, className, children, ...rest }: TagProps) {
  return (
    <span
      className={[styles.tag, className].filter(Boolean).join(' ')}
      data-kind={kind}
      data-tone={tone}
      {...rest}
    >
      {children}
    </span>
  );
}
