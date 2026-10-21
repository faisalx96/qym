import { useEffect, useRef, type ReactNode } from 'react';
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
  const listRef = useRef<HTMLDivElement>(null);
  // A strip wider than its column (five dataset tabs at 279 px) scrolls: the selected tab is kept in view.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab || orientation !== 'horizontal' || list.scrollWidth <= list.clientWidth) return;
    const box = list.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left < box.left) list.scrollLeft += at.left - box.left - 8;
    else if (at.right > box.right) list.scrollLeft += at.right - box.right + 8;
  }, [selected, orientation, items.length]);
  return (
    <AriaTabs
      selectedKey={selected}
      onSelectionChange={(k: Key) => onSelect(String(k))}
      disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)}
      orientation={orientation}
      className={[styles.tabs, className].filter(Boolean).join(' ')}
      data-variant={variant}
    >
      <TabList ref={listRef} aria-label={label} className={styles.list}>
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
  forceMount,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  /** Keep the panel element mounted (inert) while inactive so `aria-controls` always resolves. */
  forceMount?: boolean;
}) {
  return (
    <AriaTabPanel
      id={id}
      shouldForceMount={forceMount}
      className={[styles.panel, className].filter(Boolean).join(' ')}
    >
      {children}
    </AriaTabPanel>
  );
}
