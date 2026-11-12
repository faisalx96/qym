/**
 * A dataset and its version, written as the first qym wrote it (cv4 B1): the name, a thin divider, the version in
 * green, other aliases after their own divider, and the green star Production Flag when that version is the
 * production version. `DatasetVersionTag` is the one-line tag (runs table, run header); `DatasetChip` is one dataset
 * of a union run in the hero (name wraps, never cut; item count).
 */
import { Link } from 'react-router-dom';
import { Flag, Icon, Tag } from '@/ui';
import { datasetEntryLink } from '../lib/heroModel';
import type { RunDatasetEntry } from '../types';
import styles from './DatasetChip.module.css';

export function datasetEntryTitle(e: RunDatasetEntry): string {
  const count = e.items != null ? `, ${e.items} items` : '';
  return `${e.dataset}${e.version ? ` ${e.version}` : ''}${e.alias ? ` (${e.alias})` : ''}${count}${
    e.deleted ? ', dataset deleted' : ''
  }`;
}

const PRODUCTION = 'production';

/** True when the production alias points at this version. */
export function isProductionVersion(aliases: readonly string[] | null | undefined): boolean {
  return !!aliases?.includes(PRODUCTION);
}

/** "v3" for "3", "v3" or "V3": the version label of a dataset tag. */
export function versionLabel(version: string | number | null | undefined): string | null {
  if (version === null || version === undefined || version === '') return null;
  return `v${String(version).replace(/^v/i, '')}`;
}

/** The green star Production Flag of a dataset version (as the datasets VersionSwitcher draws it). */
export function ProductionFlag({ className }: { className?: string }) {
  return (
    <Flag tone="success" icon="star" className={className} title="This version is the production version">
      Production
    </Flag>
  );
}

/** A dataset with its version: database glyph, name, divider, version in green, other aliases; then Production. */
export function DatasetVersionTag({
  name,
  version,
  aliases,
  className,
}: {
  name: string | null | undefined;
  version?: string | number | null;
  aliases?: string[] | null;
  className?: string;
}) {
  if (!name) return <span className={styles.none}>—</span>;
  const v = versionLabel(version);
  const prod = v !== null && isProductionVersion(aliases);
  const others = (aliases ?? []).filter((a) => a !== PRODUCTION);
  const title = [
    name,
    v ? `version ${v}` : null,
    prod ? 'production' : null,
    others.length ? `aliases: ${others.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={[styles.versioned, className].filter(Boolean).join(' ')} data-testid="dataset-version-tag">
      <Tag kind="dataset" title={title} className={styles.tag}>
        <Icon name="database" size={12} />
        <span className={styles.tagName} dir="auto">
          {name}
        </span>
        {v ? (
          <span className={styles.segment} data-part="version">
            {v}
          </span>
        ) : null}
        {others.map((a) => (
          <span key={a} className={styles.segment} data-part="alias">
            {a}
          </span>
        ))}
      </Tag>
      {prod ? <ProductionFlag className={styles.prod} /> : null}
    </span>
  );
}

export function DatasetChip({ entry, slug }: { entry: RunDatasetEntry; slug: string | undefined }) {
  const v = versionLabel(entry.version);
  const prod = v !== null && isProductionVersion(entry.aliases);
  // the alias the run resolved by, unless it is production (the Flag says that)
  const alias = entry.alias && !(prod && entry.alias === PRODUCTION) ? entry.alias : null;
  const body = (
    <>
      <Icon name="database" size={12} />
      <span className={styles.name}>{entry.dataset}</span>
      {v ? (
        <span className={styles.version} data-part="version">
          {v}
        </span>
      ) : null}
      {alias ? <span className={styles.alias}>{alias}</span> : null}
      {prod ? <ProductionFlag className={styles.chipProd} /> : null}
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
