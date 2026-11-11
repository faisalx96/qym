import type { ReactNode } from 'react';
import styles from './KeyValueTag.module.css';

export interface KeyValueTagProps {
  /** The key (muted; wraps inside its 20ch cap). */
  label: string;
  /** The value text (mono, primary), or `children` for a richer value. */
  text?: string;
  /** Full `key: value` for the native tooltip. */
  title?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Passive key / value chip (Tag family, round 3 P6): 24px, `--bg-elevated`, the key in `--font-sm` muted, the value in mono.
 * It never acts: no hover, no focus. Both parts wrap, never '…' (C-25); the full text is also in `title`.
 */
export function KeyValueTag({ label, text, title, className, children }: KeyValueTagProps) {
  return (
    <span className={[styles.kv, className].filter(Boolean).join(' ')} title={title}>
      <span className={styles.key}>{label}</span>
      <span className={styles.value}>{children ?? text}</span>
    </span>
  );
}
