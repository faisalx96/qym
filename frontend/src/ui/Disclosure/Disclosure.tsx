import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosurePanel,
  Heading,
} from 'react-aria-components';
import { Icon } from '../Icon';
import styles from './Disclosure.module.css';

export interface DisclosureProps {
  title: ReactNode;
  /** One muted line shown next to the title while closed and open (e.g. "Default fields"). */
  summary?: ReactNode;
  /** Aligned settings rows: fixed title column, body-size summary that wraps without clipping. */
  layout?: 'inline' | 'columns';
  /** Optional control beside the toggle, outside its button. */
  aside?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  className?: string;
}

/**
 * Collapsible group: one trigger row (chevron, title, summary) and a panel that
 * animates its height in 150 ms (none under prefers-reduced-motion). Built on
 * React Aria Disclosure, so `aria-expanded`, Enter/Space and `aria-controls` are free.
 */
export function Disclosure({
  title,
  summary,
  layout = 'inline',
  aside,
  defaultOpen,
  open,
  onOpenChange,
  children,
  className,
}: DisclosureProps) {
  return (
    <AriaDisclosure
      className={[styles.disclosure, className].filter(Boolean).join(' ')}
      data-layout={layout}
      defaultExpanded={defaultOpen}
      isExpanded={open}
      onExpandedChange={onOpenChange}
    >
      <div className={styles.header} data-part="disclosure-header">
        <Heading className={styles.heading}>
          <AriaButton slot="trigger" className={styles.trigger}>
            <Icon name="chevron-right" size={12} className={styles.chevron} />
            <span className={styles.title}>{title}</span>
            {layout === 'columns' && summary != null ? ' ' : null}
            {summary ? <span className={styles.summary}>{summary}</span> : null}
          </AriaButton>
        </Heading>
        {aside}
      </div>
      <DisclosurePanel className={styles.panel}>
        <div className={styles.content} data-part="disclosure-content">
          {children}
        </div>
      </DisclosurePanel>
    </AriaDisclosure>
  );
}
