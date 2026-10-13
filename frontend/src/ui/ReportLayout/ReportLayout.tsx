import type { ReactNode } from 'react';
import { Drawer } from '../Drawer';
import styles from './ReportLayout.module.css';

export interface ReportLayoutProps {
  /** Quick-filter body; the layout shows it only while `sidebarOpen` (wide) or `drawerOpen` (narrow). */
  sidebar?: ReactNode;
  /** Wide: the inline column is shown. */
  sidebarOpen: boolean;
  /** Viewport is wide enough for the inline column; otherwise the sidebar is a Drawer. */
  wide: boolean;
  /** Narrow: the Drawer is open. */
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  sidebarLabel?: string;
  /** Sticky offset of the aside under the page chrome. */
  className?: string;
  children: ReactNode;
}

/** Report column plus an optional sticky quick-filter column (Drawer under the wide breakpoint). */
export function ReportLayout({
  sidebar,
  sidebarOpen,
  wide,
  drawerOpen = false,
  onDrawerOpenChange,
  sidebarLabel = 'Quick filters',
  className,
  children,
}: ReportLayoutProps) {
  const inline = !!sidebar && wide && sidebarOpen;
  return (
    <div
      className={[styles.layout, className].filter(Boolean).join(' ')}
      data-sidebar={inline ? 'open' : 'closed'}
    >
      <div className={styles.main}>{children}</div>
      {inline ? (
        <aside className={styles.aside} aria-label={sidebarLabel} data-testid="report-sidebar">
          {sidebar}
        </aside>
      ) : null}
      {sidebar && !wide ? (
        <Drawer
          open={drawerOpen}
          onOpenChange={(o) => onDrawerOpenChange?.(o)}
          title={sidebarLabel}
          width={360}
          className={styles.drawer}
        >
          <div className={styles.drawerBody} data-testid="report-sidebar">
            {sidebar}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
