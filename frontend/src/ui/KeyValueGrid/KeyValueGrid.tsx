import type { ReactNode } from 'react';
import styles from './KeyValueGrid.module.css';

export interface KeyValueItem {
  key: string;
  label?: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

export interface KeyValueGridProps {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3;
  dense?: boolean;
  'aria-label'?: string;
}

/** Definition grid for versioning details, account info, etc. */
export function KeyValueGrid({ items, columns = 2, dense, ...rest }: KeyValueGridProps) {
  return (
    <dl className={styles.grid} data-columns={columns} data-dense={dense ? '' : undefined} {...rest}>
      {items.map((item) => (
        <div key={item.key} className={styles.item}>
          <dt className={styles.label}>{item.label ?? item.key}</dt>
          <dd className={styles.value} data-mono={item.mono ? '' : undefined}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
