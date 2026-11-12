import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import styles from './InlineNotice.module.css';

export interface InlineNoticeProps {
  /** danger failed; warning stopped or incomplete; info a neutral fact about the view; neutral a quiet hint (grey). */
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  /** The first words, in the tone's text colour ("Failed.", "Stopped:"). */
  lead?: ReactNode;
  /** Default: 'info' for the info tone, else 'warning'. */
  icon?: IconName;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * One subtle line under a title that says what went wrong with the object on the page (DESIGN_LANGUAGE §3.7 "Inline
 * notice"): a 3px rail, a glyph and a faint wash in the tone, the lead in the tone's text colour and the rest in the
 * secondary text colour. Not a box, a banner or a toast.
 */
export function InlineNotice({ tone, lead, icon, children, className, ...rest }: InlineNoticeProps) {
  return (
    <p className={[styles.notice, className].filter(Boolean).join(' ')} data-tone={tone} {...rest}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warning')} size={14} className={styles.icon} />
      <span className={styles.text}>
        {lead ? <span className={styles.lead}>{lead}</span> : null}
        {lead && children ? ' ' : null}
        {children}
      </span>
    </p>
  );
}
