import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './entry.module.css';

interface StartCardProps {
  /** The small uppercase line ("Recommended", "Best past run"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  /** One more muted line (release note, environments). */
  meta?: ReactNode;
  compact?: boolean;
  /** Radio semantics (default). A `to` renders a link card instead. */
  checked?: boolean;
  disabled?: boolean;
  to?: string;
  onSelect?: () => void;
  titleAttr?: string;
}

/** One "Start from" choice: a big card (eyebrow, title, body, meta) or a compact one. */
export function StartCard({
  eyebrow,
  title,
  body,
  meta,
  compact,
  checked,
  disabled,
  to,
  onSelect,
  titleAttr,
}: StartCardProps) {
  const content = (
    <>
      {eyebrow ? <span className={styles.cardEyebrow}>{eyebrow}</span> : null}
      <span className={styles.cardTitle}>{title}</span>
      {body ? <span className={styles.cardHint}>{body}</span> : null}
      {meta ? <span className={styles.cardMeta}>{meta}</span> : null}
    </>
  );
  const className = [styles.card, compact ? styles.cardCompact : ''].filter(Boolean).join(' ');
  if (to) {
    return (
      <Link className={className} to={to}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={Boolean(checked)}
      aria-disabled={disabled || undefined}
      title={titleAttr}
      className={className}
      onClick={() => {
        if (!disabled) onSelect?.();
      }}
    >
      {content}
    </button>
  );
}
