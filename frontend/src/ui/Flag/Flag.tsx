import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import styles from './Flag.module.css';

export type FlagTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export interface FlagProps extends HTMLAttributes<HTMLSpanElement> {
  /** Default neutral: muted text. A toned flag is the tone's text colour at 600. */
  tone?: FlagTone;
  /** Optional decorative glyph before the word. */
  icon?: IconName;
  children: ReactNode;
}

/**
 * A fact attached to an item (Private test set, Restricted, View only, Duplicate, Irreversible): an optional icon and
 * the word in the tone colour, no pill, outline or fill (DESIGN_LANGUAGE §3.3 "Flag"). A lifecycle status is a
 * `StatusMark`, not a Flag.
 */
export function Flag({ tone = 'neutral', icon, className, children, ...rest }: FlagProps) {
  return (
    <span className={[styles.flag, className].filter(Boolean).join(' ')} data-tone={tone} {...rest}>
      {icon ? <Icon name={icon} size={12} className={styles.icon} /> : null}
      {children}
    </span>
  );
}

/** 'Required' after a slot or field name: the red Field star, then the word in the neutral Flag look (B-12). */
export function RequiredFlag(props: Omit<FlagProps, 'children' | 'tone' | 'icon'>) {
  return (
    <Flag {...props} tone="neutral" title={props.title ?? 'Required'}>
      <span className={styles.star} aria-hidden="true">
        *
      </span>
      Required
    </Flag>
  );
}
