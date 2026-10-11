import type { ReactNode } from 'react';
import { Text } from '../Text';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/** Empty state: dim 48px glyph, --font-xl title, --font-md muted body (DESIGN_LANGUAGE §3). */
export function EmptyState({ icon, title, body, action, compact }: EmptyStateProps) {
  return (
    <div className={styles.empty} data-compact={compact ? '' : undefined} data-empty-state>
      {icon ? (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Text variant="xl" as="h2" className={styles.title}>
        {title}
      </Text>
      {body ? (
        <Text variant="md" tone="muted" weight={400} as="div" className={styles.body}>
          {body}
        </Text>
      ) : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
