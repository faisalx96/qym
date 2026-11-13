/** Dataset → Lineage tab (brief 07 §2.10): parent/child tree + change log. */
import { Link } from 'react-router-dom';
import { useDatasetLineage, type DatasetVersion, type LineageChange } from '@/api/datasets';
import { useDelayedPending } from '@/lib/pending';
import {
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
  LinkButton,
  Section,
  Skeleton,
  Tag,
  Text,
  Card,
  Timeline,
} from '@/ui';
import { UserPill } from '../components/UserPill';
import { VersionBadge, AliasTags } from '../components/VersionSwitcher';
import { formatDate, pluralize } from '../lib/itemValue';
import { formatTableDate } from '@/lib/dates';
import { versionSourceText } from '../lib/versions';
import { comparePath, datasetPath } from '../lib/route';
import styles from './LineageTab.module.css';

export function LineageTab({
  slug,
  datasetRef,
  openVersionId,
}: {
  slug: string;
  datasetRef: string;
  /** The version open on the page: its card takes the selected outline (cv4 X15, as the first qym). */
  openVersionId?: string | null;
}) {
  const query = useDatasetLineage(slug, datasetRef);
  const showSkeleton = useDelayedPending(query.isPending);
  if (showSkeleton) return <Skeleton kind="list" rows={4} label="Loading lineage" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t load the version history"
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return null;
  const { versions, changes } = query.data;
  if (!versions.length)
    return <EmptyState title="No versions yet" body="Create the first draft to start the version history." />;
  const byId = new Map(versions.map((v) => [v.id, v] as const));
  const children = new Map<string | null, DatasetVersion[]>();
  for (const v of versions) {
    const parent = v.parent_version_id && byId.has(v.parent_version_id) ? v.parent_version_id : null;
    children.set(parent, [...(children.get(parent) ?? []), v]);
  }
  const roots = children.get(null) ?? [];
  const orphans = roots.filter((v) => v.parent_version_id && !byId.has(v.parent_version_id));

  const renderNode = (v: DatasetVersion, depth: number) => (
    <li key={v.id} className={styles.node} style={{ '--depth': depth } as React.CSSProperties}>
      <Card data-version-node={v.version} isSelected={v.id === openVersionId}>
        <div className={styles.grid}>
          <div className={styles.cardMain}>
            <Link
              to={datasetPath(slug, datasetRef, { tab: 'lineage', v: v.version })}
              className={styles.versionLink}
              data-link="name"
              aria-current={v.id === openVersionId ? 'true' : undefined}
            >
              {v.version}
            </Link>
            <Text as="span" variant="md" weight={600}>
              {v.name || <em className={styles.unnamed}>unnamed</em>}
            </Text>
            <VersionBadge version={v} />
            <AliasTags version={v} />
            <span className={styles.meta}>
              {pluralize(v.item_count, 'item')} · {pluralize(v.run_count, 'run')}
            </span>
            {v.change_counts ? (
              <span className={styles.changes} role="group" aria-label="Changes vs parent">
                {v.change_counts.added ? (
                  <Tag kind="count" tone="success">
                    +{v.change_counts.added}
                  </Tag>
                ) : null}
                {v.change_counts.deleted ? (
                  <Tag kind="count" tone="danger">
                    −{v.change_counts.deleted}
                  </Tag>
                ) : null}
                {v.change_counts.modified ? (
                  <Tag kind="count" tone="warning">
                    ~{v.change_counts.modified}
                  </Tag>
                ) : null}
                {v.change_counts.disabled ? <Tag>{v.change_counts.disabled} disabled</Tag> : null}
                {v.change_counts.enabled ? <Tag>{v.change_counts.enabled} enabled</Tag> : null}
              </span>
            ) : null}
          </div>
          <div className={styles.cardSide}>
            <UserPill user={v.published_by} label="Published by" />
            <UserPill user={v.created_by} label="Drafted by" />
            {v.parent_version_id && byId.has(v.parent_version_id) ? (
              <LinkButton
                to={comparePath(slug, datasetRef, {
                  base: byId.get(v.parent_version_id)?.version,
                  head: v.version,
                })}
                variant="neutral"
                size="sm"
              >
                Compare
              </LinkButton>
            ) : null}
          </div>
          <div className={styles.dates}>
            {/* the version's origin, which the dataset header no longer lists (C042) */}
            {versionSourceText(v, v.parent_version_id ? byId.get(v.parent_version_id) : null)
              ? `${versionSourceText(v, v.parent_version_id ? byId.get(v.parent_version_id) : null)} · `
              : ''}
            created {formatDate(v.created_at)}
            {v.published_at ? ` · published ${formatDate(v.published_at)}` : ''}
            {orphans.includes(v) ? ' · parent version no longer exists' : ''}
          </div>
        </div>
      </Card>
      {children.get(v.id)?.length ? (
        <ul className={styles.children}>{children.get(v.id)!.map((c) => renderNode(c, depth + 1))}</ul>
      ) : null}
    </li>
  );

  return (
    <div className={styles.wrap} data-dataset-lineage>
      <Section
        title="Version history"
        description="How each version descends from its parent, and what changed along the way. Open a version from its name."
      >
        <ul className={styles.tree}>{roots.map((v) => renderNode(v, 0))}</ul>
      </Section>
      <Section title="Change log" description="Every change to this dataset’s versions, oldest first.">
        {changes.length ? (
          // cv4 E10, cv5 H5: the shared Timeline, one mark on the rail for each event, then the time, what happened
          // and, directly after it (cv4 Y8), who did it
          <Card>
            <Timeline
              aria-label="Change log"
              items={changes.map((c) => ({
                key: c.id,
                time: formatTableDate(c.created_at),
                timeTitle: formatDate(c.created_at),
                dateTime: c.created_at,
                icon: CHANGE_ICON[c.change_summary.type] ?? 'edit',
                tone: changeTone(c) ?? 'neutral',
                title: withVersions(describeChange(c, byId)),
                meta: <UserPill user={c.actor} />,
              }))}
            />
          </Card>
        ) : (
          <Text variant="sm" tone="muted">
            No changes recorded.
          </Text>
        )}
      </Section>
    </div>
  );
}

/** The mark of a change log event (cv4 E10). */
const CHANGE_ICON: Record<string, IconName> = {
  created: 'plus',
  published: 'check',
  alias_set: 'star',
  uploaded: 'upload',
};

/** Publishing and the production alias are the events a run picks up: their marks take the accent. */
export function changeTone(c: LineageChange): 'accent' | undefined {
  const s = c.change_summary;
  return s.type === 'published' || (s.type === 'alias_set' && (s.alias ?? 'production') === 'production')
    ? 'accent'
    : undefined;
}

/** The event text with each version name (v1, v2 ...) in the version face. */
function withVersions(text: string) {
  return text.split(/\b(v\d+)\b/).map((part, i) =>
    i % 2 ? (
      <span key={i} className={styles.logVersion}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function describeChange(c: LineageChange, byId: Map<string, DatasetVersion>): string {
  const v = byId.get(c.dataset_version_id)?.version ?? 'a version';
  const s = c.change_summary;
  switch (s.type) {
    case 'created': {
      const from = s.from_version_id ? byId.get(s.from_version_id)?.version : null;
      return `${v} created${from ? ` from ${from}` : ''}${s.item_count != null ? ` with ${pluralize(s.item_count, 'item')}` : ''}`;
    }
    case 'published':
      return `${v} published${s.item_count != null ? ` (${pluralize(s.item_count, 'item')})` : ''}`;
    case 'uploaded':
      return `${pluralize(s.item_count ?? 0, 'item')} uploaded into ${v}${s.source_type ? ` from a ${String(s.source_type).toUpperCase()} file` : ''}`;
    case 'alias_set':
      return `alias “${s.alias ?? 'production'}” set to ${v}`;
    default:
      return `${s.type} on ${v}`;
  }
}
