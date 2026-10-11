import type { ReactNode } from 'react';
import { Tag } from '@/ui';
import type { SlotBinding } from '../model';
import styles from './models.module.css';

type Temporary = Extract<SlotBinding, { kind: 'temporary' }>;

/**
 * A temporary model: name, URL and what the key's state is. The key itself is never rendered;
 * "key kept in memory only" says where it lives.
 */
export function TemporaryChip({ binding, children }: { binding: Temporary; children?: ReactNode }) {
  return (
    <div className={styles.bound} data-temporary-chip>
      <Tag tone="warning">Temporary</Tag>
      <span className={styles.mono}>
        {binding.label && binding.label !== binding.model
          ? `${binding.label} (${binding.model})`
          : binding.model}
      </span>
      {binding.baseUrl ? <span className={`${styles.hint} ${styles.mono}`}>{binding.baseUrl}</span> : null}
      {binding.secretRef ? <Tag>key kept in memory only</Tag> : <Tag tone="danger">no API key</Tag>}
      {binding.save ? <Tag kind="accent">will be saved to project models</Tag> : null}
      {children}
    </div>
  );
}
