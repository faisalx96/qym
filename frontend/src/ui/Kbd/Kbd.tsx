import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={[styles.kbd, className].filter(Boolean).join(' ')}>{children}</kbd>;
}
