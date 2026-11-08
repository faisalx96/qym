/**
 * /projects/:slug/datasets/:ref/compare?base=&head=&tab= (brief 07 §2.13):
 * summary strip, kind tabs paged 50 at a time, collapsible rows with
 * word-level diffs (first 3 open), Download diff (un-paged compare as JSON).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchFullCompare,
  useCompare,
  useDataset,
  useDatasetVersions,
  type CompareChangedEntry,
  type CompareItemEntry,
  type CompareKind,
  type DatasetVersion,
} from '@/api/datasets';
import { useDelayedPending } from '@/lib/pending';
import { useCrumbLabel } from '@/lib/crumb-label';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LinkButton,
  PageHeader,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
  Tag,
  Text,
  useToast,
  StatusMark,
} from '@/ui';
import { FieldDiff } from '../components/FieldDiff';
import { UserPill } from '../components/UserPill';
import { fieldLabel, formatDate, itemIdentity } from '../lib/itemValue';
import { comparePath, datasetPath, parseDatasetRoute } from '../lib/route';
import { resolveActiveVersion, versionStatusLabel } from '../lib/versions';
import styles from './DatasetComparePage.module.css';
import { APP_LOCALE } from '@/lib/dates';

const KINDS: { id: CompareKind; label: string }[] = [
  { id: 'changed', label: 'Changed' },
  { id: 'added', label: 'Added' },
  { id: 'removed', label: 'Removed' },
  { id: 'unchanged', label: 'Unchanged' },
];

export function DatasetComparePage({ datasetRef }: { datasetRef: string }) {
  const { slug, project } = useProjectContext();
  const [params] = useSearchParams();
  const route = parseDatasetRoute(`${datasetRef}/compare`, params);
  const navigate = useNavigate();
  const dsQuery = useDataset(slug, datasetRef);
  const versionsQuery = useDatasetVersions(slug, datasetRef, Boolean(dsQuery.data));
  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const dataset = dsQuery.data;
  useCrumbLabel(dataset?.name);
  useDocumentTitle(dataset ? `${dataset.name} · Compare` : `${project.name} · Compare versions`);

  // Defaults: head = active (production/newest), base = its parent or the previous version.
  const head = useMemo(
    () =>
      route.head
        ? (versions.find((v) => v.version === route.head) ?? null)
        : resolveActiveVersion(versions, null),
    [versions, route.head],
  );
  const base = useMemo(() => {
    if (route.base) return versions.find((v) => v.version === route.base) ?? null;
    if (!head) return null;
    return (
      versions.find((v) => v.id === head.parent_version_id) ?? versions.find((v) => v.id !== head.id) ?? null
    );
  }, [versions, route.base, head]);
  useEffect(() => {
    if (!versions.length || !head || !base) return;
    if (route.head !== head.version || route.base !== base.version)
      navigate(
        comparePath(slug, datasetRef, {
          base: base.version,
          head: head.version,
          tab: route.compareTab === 'changed' ? null : route.compareTab,
        }),
        { replace: true },
      );
  }, [versions.length, head, base, route.head, route.base, route.compareTab, navigate, slug, datasetRef]);

  const showSkeleton = useDelayedPending(
    dsQuery.isPending || (Boolean(dsQuery.data) && versionsQuery.isPending),
  );
  if (showSkeleton && !dataset)
    return (
      <div className={fullWidth}>
        <Skeleton kind="lines" rows={4} label="Loading" />
      </div>
    );
  if (dsQuery.isError)
    return (
      <div className={fullWidth}>
        <ErrorState
          error={dsQuery.error}
          title="Couldn’t load this dataset"
          onRetry={() => void dsQuery.refetch()}
        />
      </div>
    );
  if (versionsQuery.isError)
    return (
      <div className={fullWidth}>
        <ErrorState
          error={versionsQuery.error}
          title="Couldn’t load versions"
          onRetry={() => void versionsQuery.refetch()}
        />
      </div>
    );
  if (!dataset || !versionsQuery.data) return null;
  if (versions.length < 2) {
    return (
      <div className={fullWidth}>
        <PageHeader title="Compare versions" description={dataset.name} />
        <EmptyState
          title="Nothing to compare yet"
          body="Create a second version to compare items between versions."
          action={
            <LinkButton
              to={datasetPath(slug, dataset.slug)}
              variant="neutral"
              icon={<Icon name="prev" size={12} />}
            >
              Back to the dataset
            </LinkButton>
          }
        />
      </div>
    );
  }
  if (!dataset.items_visible) {
    return (
      <div className={fullWidth}>
        <PageHeader title="Compare versions" description={dataset.name} />
        <EmptyState
          icon={<Icon name="lock" />}
          title="Private test set"
          body="Item contents are hidden from non-admins, so versions cannot be compared."
        />
      </div>
    );
  }
  if (!head || !base) {
    const missing = [route.base && !base ? route.base : null, route.head && !head ? route.head : null]
      .filter(Boolean)
      .join(', ');
    return (
      <div className={fullWidth}>
        <PageHeader title="Compare versions" description={dataset.name} />
        <EmptyState
          title="Version not found"
          body={`Dataset version or alias not found${missing ? `: ${missing}` : ''}.`}
          action={
            <LinkButton to={comparePath(slug, dataset.slug)} variant="neutral">
              Compare the default versions
            </LinkButton>
          }
        />
      </div>
    );
  }

  const items = versions.map((v) => ({
    key: v.version,
    // the status in words, Production in full (C168); a select option cannot hold a status mark
    label: `${v.version}${v.name ? ` — ${v.name}` : ''} · ${versionStatusLabel(v)}`,
  }));
  const go = (next: { base?: string; head?: string; tab?: CompareKind }) =>
    navigate(
      comparePath(slug, dataset.slug, {
        base: next.base ?? base.version,
        head: next.head ?? head.version,
        tab: (next.tab ?? route.compareTab) === 'changed' ? null : (next.tab ?? route.compareTab),
      }),
    );

  return (
    <div className={fullWidth} data-compare-page>
      <PageHeader
        title="Compare versions"
        description={dataset.name}
        actions={
          <div className={styles.heroActions}>
            <Select
              label="Base"
              items={items}
              value={base.version}
              onChange={(k) => k && go({ base: String(k) })}
              searchable="auto"
              width={220}
            />
            <IconButton
              label="Swap base and head"
              icon="swap"
              onPress={() => go({ base: head.version, head: base.version })}
              data-testid="compare-swap"
            />
            <Select
              label="Head"
              items={items}
              value={head.version}
              onChange={(k) => k && go({ head: String(k) })}
              searchable="auto"
              width={220}
            />
            <LinkButton to={datasetPath(slug, dataset.slug, { v: base.version })} variant="neutral">
              Open base
            </LinkButton>
            <LinkButton to={datasetPath(slug, dataset.slug, { v: head.version })} variant="neutral">
              Open head
            </LinkButton>
            <DownloadDiff
              slug={slug}
              datasetRef={dataset.slug}
              datasetSlug={dataset.slug}
              base={base}
              head={head}
            />
          </div>
        }
      />
      <CompareBody
        slug={slug}
        datasetRef={dataset.slug}
        base={base}
        head={head}
        kind={route.compareTab}
        onKind={(k) => go({ tab: k })}
      />
    </div>
  );
}

function DownloadDiff({
  slug,
  datasetRef,
  datasetSlug,
  base,
  head,
}: {
  slug: string;
  datasetRef: string;
  datasetSlug: string;
  base: DatasetVersion;
  head: DatasetVersion;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="accent"
      icon={<Icon name="download" size={12} />}
      loading={busy}
      data-testid="download-diff"
      onPress={async () => {
        setBusy(true);
        try {
          const full = await fetchFullCompare(slug, datasetRef, head.version, base.version);
          const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${datasetSlug}_${base.version}_vs_${head.version}.diff.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          toast.show('Couldn’t download the diff', { tone: 'error' });
        } finally {
          setBusy(false);
        }
      }}
    >
      Download diff
    </Button>
  );
}

function CompareBody({
  slug,
  datasetRef,
  base,
  head,
  kind,
  onKind,
}: {
  slug: string;
  datasetRef: string;
  base: DatasetVersion;
  head: DatasetVersion;
  kind: CompareKind;
  onKind: (k: CompareKind) => void;
}) {
  const query = useCompare(slug, datasetRef, head.version, base.version, kind);
  const showSkeleton = useDelayedPending(query.isPending);
  const first = query.data?.pages[0];
  const summary = first?.summary;
  if (showSkeleton) return <Skeleton kind="table" rows={6} label="Comparing versions" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title="Couldn’t compare these versions"
        onRetry={() => void query.refetch()}
      />
    );
  if (!first || !summary || !query.data) return null;
  const total = first.page?.total ?? summary[kind];

  const rows: { id: string; node: React.ReactNode }[] = [];
  for (const page of query.data.pages) {
    if (kind === 'changed') {
      for (const entry of page.field_diffs ?? page.changed ?? [])
        rows.push({ id: entry.item_id, node: <ChangedRow entry={entry} defaultOpen={rows.length < 3} /> });
    } else {
      const list =
        (kind === 'added'
          ? page.added_items
          : kind === 'removed'
            ? page.removed_items
            : page.unchanged_items) ?? [];
      for (const item of list)
        rows.push({
          id: item.item_id,
          node: <ItemRow item={item} kind={kind} head={head.version} defaultOpen={rows.length < 3} />,
        });
    }
  }

  return (
    <div className={styles.body} data-compare-kind={kind}>
      {/* The tabs carry the counts; the strip that repeated them is gone (C240). */}
      <Tabs
        label="Comparison kinds"
        items={KINDS.map((k) => ({ id: k.id, label: k.label, count: summary[k.id] }))}
        selected={kind}
        onSelect={(id) => onKind(id as CompareKind)}
      >
        <TabPanel id={kind}>
          {summary.disabled || summary.enabled ? (
            <Text variant="sm" tone="secondary" data-testid="compare-state-line">
              {[
                summary.disabled ? `${plural(summary.disabled)} disabled in ${head.version}` : '',
                summary.enabled ? `${plural(summary.enabled)} enabled in ${head.version}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {kind === 'changed' && rows.length ? (
            <Text variant="sm" tone="muted">
              Listed in the order the changes happened, oldest first.
            </Text>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState compact title={`No ${kind} items between ${base.version} and ${head.version}`} />
          ) : (
            <ul className={styles.list} aria-label={`${kind} items`}>
              {rows.map((r) => (
                <li key={r.id}>{r.node}</li>
              ))}
            </ul>
          )}
          <div className={styles.footer}>
            <Text variant="sm" tone="muted">
              Showing {rows.length.toLocaleString(APP_LOCALE)} of {total.toLocaleString(APP_LOCALE)}
            </Text>
            {query.hasNextPage ? (
              <Button
                variant="neutral"
                onPress={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
                data-testid="compare-more"
              >
                Show {Math.min(50, total - rows.length)} more
              </Button>
            ) : null}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}

const FIELDS = ['input', 'expected_output', 'metadata', 'labels', 'state'] as const;

function plural(n: number) {
  return `${n} item${n === 1 ? '' : 's'}`;
}

/** An item whose state differs between the two versions: Active → Disabled (spec A2-46). */
function StateDiff({ before, after }: { before?: 'active' | 'disabled'; after?: 'active' | 'disabled' }) {
  const name = (v?: string) => (v === 'disabled' ? 'Disabled' : 'Active');
  const badge = (v?: string) =>
    v === 'disabled' ? (
      <StatusMark tone="warning" shape="pause" label={name(v)} data-status="disabled" />
    ) : (
      <StatusMark tone="success" shape="full" label={name(v)} />
    );
  return (
    <div
      className={styles.stateDiff}
      data-testid="compare-state-row"
      aria-label={`state changed from ${name(before)} to ${name(after)}`}
    >
      <Text as="span" variant="sm" weight={650} tone="muted">
        {fieldLabel('state')}
      </Text>
      {badge(before)}
      <Icon name="next" size={12} />
      {badge(after)}
    </div>
  );
}

function ChangedRow({ entry, defaultOpen }: { entry: CompareChangedEntry; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const fields =
    entry.fields ??
    (entry.before && entry.after
      ? FIELDS.filter(
          (f) =>
            JSON.stringify(entry.before?.[f as keyof typeof entry.before]) !==
            JSON.stringify(entry.after?.[f as keyof typeof entry.after]),
        )
      : []);
  return (
    <article className={styles.row} data-compare-row={entry.item_id}>
      <button
        type="button"
        className={styles.rowHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className={styles.rowId}>
          {itemIdentity(entry.item_id, entry.target_index ?? entry.base_index)}
        </span>
        <Tag tone="warning">changed</Tag>
        <span className={styles.rowMeta}>
          {entry.changed_at
            ? `${entry.changed_at_source === 'version' ? 'version created' : 'changed'} ${formatDate(entry.changed_at)}`
            : ''}
          {fields.length ? ` · fields: ${fields.map(fieldLabel).join(', ')}` : ''}
        </span>
        <span className={styles.rowSide}>
          <UserPill user={entry.edited_by} label="Edited By:" />
        </span>
      </button>
      {open ? (
        <div className={styles.rowBody}>
          {entry.before && entry.after ? (
            fields.map((f) =>
              f === 'state' ? (
                <StateDiff key={f} before={entry.before?.state} after={entry.after?.state} />
              ) : (
                <FieldDiff
                  key={f}
                  field={fieldLabel(f)}
                  before={entry.before?.[f as keyof typeof entry.before]}
                  after={entry.after?.[f as keyof typeof entry.after]}
                />
              ),
            )
          ) : (
            <Text variant="sm" tone="muted">
              Field contents are not included (diffs truncated by the server).
            </Text>
          )}
        </div>
      ) : null}
    </article>
  );
}

function ItemRow({
  item,
  kind,
  head,
  defaultOpen,
}: {
  item: CompareItemEntry;
  kind: CompareKind;
  /** The head version's name: a removed item says where it went (C064). */
  head: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // A removed item exists only in the base: it shows as "before" with the red rail, not as an added "after" (C064).
  const removed = kind === 'removed';
  return (
    <article className={styles.row} data-compare-row={item.item_id}>
      <button
        type="button"
        className={styles.rowHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className={styles.rowId}>{itemIdentity(item.item_id, item.index)}</span>
        <Tag tone={kind === 'added' ? 'success' : kind === 'removed' ? 'danger' : undefined}>{kind}</Tag>
        <span className={styles.rowMeta}>
          {removed
            ? `removed in ${head}`
            : item.changed_at
              ? `${item.changed_at_source === 'version' ? 'version created' : 'changed'} ${formatDate(item.changed_at)}`
              : ''}
        </span>
        <span className={styles.rowSide}>
          <UserPill user={item.edited_by} label="Edited By:" />
        </span>
      </button>
      {open ? (
        <div className={styles.rowBody}>
          {(['input', 'expected_output', 'metadata'] as const).map((f) => (
            <FieldDiff
              key={f}
              field={fieldLabel(f)}
              before={item[f]}
              after={item[f]}
              onlyAfter={!removed}
              onlyBefore={removed}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}
