import type { ReactNode } from 'react';
import styles from './CountTile.module.css';

/** A count inside a button, a checkbox label or a menu item, after the label: the number centred in an 18px tile (B-28). */
export function CountTile({ children }: { children: ReactNode }) {
  return <span className={styles.tile}>{children}</span>;
}
