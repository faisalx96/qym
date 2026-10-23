/** One dataset version of a union run: database glyph, name (wraps, never cut), version, alias, item count. */
import { Link } from 'react-router-dom';
import { Icon, Tag } from '@/ui';
import { datasetEntryLink } from '../lib/heroModel';
import type { RunDatasetEntry } from '../types';
import styles from './DatasetChip.module.css';

export function datasetEntryTitle(e: RunDatasetEntry): string {
  const count = e.items != null ? `, ${e.items} items` : '';
  return `${e.dataset}${e.version ? ` ${e.version}` : ''}${e.alias ? ` (${e.alias})` : ''}${count}${
    e.deleted ? ', dataset deleted' : ''
  }`;
}

export function DatasetChip({ entry, slug }: { entry: RunDatasetEntry; slug: string | undefined }) {
  const body = (
    <>
      <Icon name="database" size={12} />
      <span className={styles.name}>{entry.dataset}</span>
      {entry.version ? <span className={styles.version}>{entry.version}</span> : null}
      {entry.alias ? <span className={styles.alias}>{entry.alias}</span> : null}
      {entry.items != null ? (
        <span className={styles.count}>{entry.items.toLocaleString('en-US')} items</span>
      ) : null}
      {entry.deleted ? <span className={styles.deleted}>deleted</span> : null}
    </>
  );
  const to = datasetEntryLink(slug, entry);
  return to ? (
    <Link
      className={styles.chip}
      to={to}
      data-link="block"
      data-testid="hero-dataset-chip"
      title={datasetEntryTitle(entry)}
    >
      {body}
    </Link>
  ) : (
    <span
      className={styles.chip}
      data-testid="hero-dataset-chip"
      data-deleted={entry.deleted ? '' : undefined}
      title={datasetEntryTitle(entry)}
    >
      {body}
    </span>
  );
}

/** The `{n} datasets` count tag of the Datasets fact, the runs list and the compare cards. */
export function DatasetCountTag({
  count,
  title,
  testId,
}: {
  count: number;
  title?: string;
  testId?: string;
}) {
  return (
    <Tag kind="count" title={title} data-testid={testId}>
      <Icon name="database" size={12} /> {count} datasets
    </Tag>
  );
}

export { styles as datasetChipStyles };
