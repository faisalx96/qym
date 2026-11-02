import type { ReactNode } from 'react';
import { scrollCue, useScrollCue } from '@/ui';
import styles from './settings.module.css';

/** The scrolling frame of an overrides table: bordered, with an edge fade on the side that still has columns. */
export function TableWrap({ children }: { children: ReactNode }) {
  const ref = useScrollCue<HTMLDivElement>();
  return (
    <div ref={ref} className={`${styles.tableWrap} ${scrollCue}`} data-table-wrap="">
      {children}
    </div>
  );
}
