/** Toolbar + item list (the page body). */
import { useMemo } from 'react';
import { EmptyState } from '@/ui';
import { HIDDEN_METADATA_KEYS } from '@/features/run-detail/lib/rowMeta';
import { useCompare } from '../../CompareContext';
import { ItemList } from './ItemList';
import { ItemsToolbar } from './ItemsToolbar';
import styles from './ItemsSection.module.css';

export function ItemsSection() {
  const { model, items } = useCompare();
  const metaKeys = useMemo(
    () => model.metadataKeys.filter((k) => !HIDDEN_METADATA_KEYS.has(k)),
    [model.metadataKeys],
  );
  if (model.alignment.status !== 'aligned')
    return (
      <EmptyState
        compact
        title="Item-level comparison is unavailable"
        body="These runs cannot be aligned item by item; the run-level analytics still work."
      />
    );
  return (
    <div className={styles.section}>
      <ItemsToolbar metaKeys={metaKeys} />
      {items.length ? (
        <ItemList />
      ) : (
        <EmptyState compact title="No items match" body="Clear a filter or the search to see more items." />
      )}
    </div>
  );
}
