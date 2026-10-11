import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Eyebrow.module.css';

export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'muted' | 'danger' | 'accent';
  children: ReactNode;
}

/** Uppercase --font-sm label (DESIGN_LANGUAGE §3 "Uppercase label / eyebrow"). */
export function Eyebrow({ tone = 'muted', className, children, ...rest }: EyebrowProps) {
  return (
    <span className={[styles.eyebrow, className].filter(Boolean).join(' ')} data-tone={tone} {...rest}>
      {children}
    </span>
  );
}
