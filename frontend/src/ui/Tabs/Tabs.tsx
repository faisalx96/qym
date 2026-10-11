import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel as AriaTabPanel, Tabs as AriaTabs, type Key } from 'react-aria-components';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
  tone?: 'danger';
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** underline (default) | dense (elevated strip with count tiles) */
  variant?: 'underline' | 'dense';
  /** `<TabPanel id>` children */
  children?: ReactNode;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

/** Section navigation: roving focus, Left/Right/Home/End, automatic activation. */
export function Tabs({
  label,
  items,
  selected,
  onSelect,
  variant = 'underline',
  children,
  className,
  orientation = 'horizontal',
}: TabsProps) {
  return (
    <AriaTabs
      selectedKey={selected}
      onSelectionChange={(k: Key) => onSelect(String(k))}
      disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)}
      orientation={orientation}
      className={[styles.tabs, className].filter(Boolean).join(' ')}
      data-variant={variant}
    >
      <TabList aria-label={label} className={styles.list}>
        {items.map((item) => (
          <Tab key={item.id} id={item.id} className={styles.tab} data-tone={item.tone}>
            <span>{item.label}</span>
            {typeof item.count === 'number' ? <span className={styles.count}>{item.count}</span> : null}
          </Tab>
        ))}
      </TabList>
      {children}
    </AriaTabs>
  );
}

export function TabPanel({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AriaTabPanel id={id} className={[styles.panel, className].filter(Boolean).join(' ')}>
      {children}
    </AriaTabPanel>
  );
}
