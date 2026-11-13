/**
 * A dataset and its version, written as the first qym wrote it (cv4 B1): the name, a thin divider, the version, then
 * other aliases after their own divider. The version's colour is its status (owner, 13 Nov): green = production,
 * blue = published, amber = draft. No "Production" word follows the tag: the colour and the tooltip say it.
 * `DatasetVersionTag` is the one-line tag (runs table, run header); `DatasetChip` is one dataset of a union run in
 * the hero (name wraps, never cut; item count).
 */
import { Link } from 'react-router-dom';
import { Icon, Tag } from '@/ui';
import { datasetEntryLink } from '../lib/heroModel';
import type { RunDatasetEntry } from '../types';
import styles from './DatasetChip.module.css';

export function datasetEntryTitle(e: RunDatasetEntry): string {
  const count = e.items != null ? `, ${e.items} items` : '';
  const tone = e.version ? versionTone(e.status, e.aliases) : null;
  const status = tone ? `, ${VERSION_TONE_WORD[tone].toLowerCase()}` : '';
  return `${e.dataset}${e.version ? ` ${e.version}` : ''}${status}${e.alias ? ` (${e.alias})` : ''}${count}${
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

export type VersionStatus = 'draft' | 'published' | 'archived';
/** The colour of a version label: its status. `none` = status not known (older payload) or archived. */
export type VersionTone = 'production' | 'published' | 'draft' | 'none';

export const VERSION_TONE_WORD: Record<Exclude<VersionTone, 'none'>, string> & { none: string } = {
  production: 'Production',
  published: 'Published',
  draft: 'Draft',
  none: '',
};

/** Production wins (the production alias points at the version); then the version's own status. */
export function versionTone(
  status: VersionStatus | string | null | undefined,
  aliases: readonly string[] | null | undefined,
): VersionTone {
  if (isProductionVersion(aliases)) return 'production';
  if (status === 'published') return 'published';
  if (status === 'draft') return 'draft';
  return 'none';
}

/**
 * The tooltip of an alias segment (cv5 M3): an alias is a name that points at a version, so the person can tell
 * "baseline" from a version or a status.
 */
export function aliasTitle(alias: string, version: string | null): string {
  return `Alias ${alias}: a name that points at ${version ?? 'a version'}`;
}

/**
 * An alias segment: the at-sign of the run label (`name@alias`, for example `retail-text2sql@baseline`), then the
 * alias, with the tooltip that says what an alias is.
 */
function AliasText({ alias }: { alias: string }) {
  return (
    <>
      <span className={styles.at}>@</span>
      {alias}
    </>
  );
}

/** A dataset with its version: database glyph, name, divider, version in its status colour, other aliases. */
export function DatasetVersionTag({
  name,
  version,
  status,
  aliases,
  className,
}: {
  name: string | null | undefined;
  version?: string | number | null;
  status?: VersionStatus | null;
  aliases?: string[] | null;
  className?: string;
}) {
  if (!name) return <span className={styles.none}>—</span>;
  const v = versionLabel(version);
  const tone = v !== null ? versionTone(status, aliases) : 'none';
  const others = (aliases ?? []).filter((a) => a !== PRODUCTION);
  const title = [
    name,
    v ? `version ${v}` : null,
    tone !== 'none' ? VERSION_TONE_WORD[tone].toLowerCase() : null,
    others.length ? `aliases: ${others.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className={[styles.versioned, className].filter(Boolean).join(' ')}
      data-testid="dataset-version-tag"
    >
      <Tag kind="dataset" title={title} className={styles.tag}>
        <Icon name="database" size={12} />
        <span className={styles.tagName} dir="auto">
          {name}
        </span>
        {v ? (
          <span className={styles.segment} data-part="version" data-status={tone}>
            {v}
          </span>
        ) : null}
        {others.map((a) => (
          <span key={a} className={styles.segment} data-part="alias" title={aliasTitle(a, v)}>
            <AliasText alias={a} />
          </span>
        ))}
      </Tag>
    </span>
  );
}

export function DatasetChip({ entry, slug }: { entry: RunDatasetEntry; slug: string | undefined }) {
  const v = versionLabel(entry.version);
  const tone = v !== null ? versionTone(entry.status, entry.aliases) : 'none';
  // the alias the run resolved by, unless it is production (the green version says that)
  const alias = entry.alias && !(tone === 'production' && entry.alias === PRODUCTION) ? entry.alias : null;
  const body = (
    <>
      <Icon name="database" size={12} />
      <span className={styles.name}>{entry.dataset}</span>
      {v ? (
        <span className={styles.version} data-part="version" data-status={tone}>
          {v}
        </span>
      ) : null}
      {alias ? (
        <span className={styles.alias} data-part="alias" title={aliasTitle(alias, v)}>
          <AliasText alias={alias} />
        </span>
      ) : null}
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
