import type { ReactNode } from 'react';
import { HelpMarker } from '../HelpMarker';
import styles from './StatStrip.module.css';

export interface StatStripItem {
  key?: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  help?: string;
  icon?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
}

export interface StatStripProps {
  items: StatStripItem[];
  variant?: 'band' | 'compact-header';
  'aria-label'?: string;
}

/** Connected statistics band (DESIGN_LANGUAGE §3 "Connected statistics"). */
export function StatStrip({ items, variant = 'band', ...rest }: StatStripProps) {
  return (
    <div className={styles.strip} data-variant={variant} role="group" {...rest}>
      {items.map((item, i) => (
        <div key={item.key ?? i} className={styles.item}>
          {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
          <div className={styles.stack}>
            <div className={styles.label}>
              <span>{item.label}</span>
              {item.help ? <HelpMarker label={String(item.label)}>{item.help}</HelpMarker> : null}
            </div>
            <div className={styles.value} data-tone={item.tone}>
              {item.value}
            </div>
            {item.sub ? <div className={styles.sub}>{item.sub}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
