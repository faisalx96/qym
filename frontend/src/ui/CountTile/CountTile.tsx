import type { ReactNode } from 'react';
import styles from './CountTile.module.css';

export interface CountTileProps {
  children: ReactNode;
  /** 'danger' = the red tint of an error count ("Errors 18"); the numeral stays readable. */
  tone?: 'danger';
  className?: string;
}

/**
 * The one count badge (cv4 F12): a count after a label, inside a button, a checkbox label, a menu item, a tab or a
 * field chip, the number centred in an 18px tile (B-28). The Tabs and run-page nav counts draw the same tile.
 */
export function CountTile({ children, tone, className }: CountTileProps) {
  return (
    <span className={[styles.tile, className].filter(Boolean).join(' ')} data-tone={tone}>
      {children}
    </span>
  );
}
